const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJiti } = require('jiti');

const jiti = createJiti(__filename);
const mod = jiti('../index.ts');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pi-system-reminders-'));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function withAgentDir(fn) {
  const prev = process.env.PI_CODING_AGENT_DIR;
  const dir = tempDir();
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
}

function fakePi() {
  const handlers = new Map();
  const messages = [];
  const commands = new Map();
  return {
    handlers,
    messages,
    commands,
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
    sendMessage(message, options) {
      messages.push({ message, options });
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
  };
}

function fakeCtx(cwd, branch = []) {
  const notifications = [];
  return {
    cwd,
    notifications,
    sessionManager: { getBranch: () => branch },
    ui: { notify: (message, level) => notifications.push({ message, level }) },
  };
}

test('discovers global reminders', () => withAgentDir((agentDir) => {
  const cwd = tempDir();
  write(path.join(agentDir, 'reminders', 'global.ts'), 'export default () => ({ on: "turn_end", when: () => false, message: "global" });');

  const result = mod.loadReminders(fakePi(), cwd);

  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(result.reminders.map((r) => r.name), ['global']);
}));

test('discovers project reminders', () => withAgentDir(() => {
  const cwd = tempDir();
  write(path.join(cwd, '.pi', 'reminders', 'project.ts'), 'export default () => ({ on: "turn_end", when: () => false, message: "project" });');

  const result = mod.loadReminders(fakePi(), cwd);

  assert.equal(result.diagnostics.length, 0);
  assert.deepEqual(result.reminders.map((r) => r.name), ['project']);
}));

test('project reminder overrides global reminder with same name', () => withAgentDir((agentDir) => {
  const cwd = tempDir();
  write(path.join(agentDir, 'reminders', 'same.ts'), 'export default () => ({ on: "turn_end", when: () => true, message: "global" });');
  write(path.join(cwd, '.pi', 'reminders', 'same.ts'), 'export default () => ({ on: "turn_end", when: () => true, message: "project" });');

  const result = mod.loadReminders(fakePi(), cwd);

  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.reminders.length, 1);
  assert.match(result.reminders[0].path, /\.pi\/reminders\/same\.ts$/);
}));

test('cooldown and once suppress repeated firing', async () => {
  const pi = fakePi();
  const ctx = fakeCtx(tempDir(), [{}]);
  const diagnostics = [];
  const reminders = [{
    name: 'cool',
    reminder: { on: 'turn_end', when: () => true, message: 'hello', cooldown: 2, once: true },
    events: new Set(['turn_end']),
    evalCount: 0,
    lastFiredAt: -Infinity,
    fired: false,
    path: '/tmp/cool.ts',
  }];

  await mod.evaluate('turn_end', reminders, diagnostics, {}, ctx, pi);
  await mod.evaluate('turn_end', reminders, diagnostics, {}, ctx, pi);
  await mod.evaluate('turn_end', reminders, diagnostics, {}, ctx, pi);
  await mod.evaluate('turn_end', reminders, diagnostics, {}, ctx, pi);

  assert.equal(pi.messages.length, 1);
});

test('stale ctx.sessionManager.getBranch does not throw', async () => {
  const pi = fakePi();
  const ctx = { sessionManager: { getBranch: () => { throw new Error('stale'); } } };
  const diagnostics = [];
  const reminders = [{
    name: 'stale',
    reminder: { on: 'turn_end', when: () => true, message: 'hello' },
    events: new Set(['turn_end']),
    evalCount: 0,
    lastFiredAt: -Infinity,
    fired: false,
    path: '/tmp/stale.ts',
  }];

  await assert.doesNotReject(() => mod.evaluate('turn_end', reminders, diagnostics, {}, ctx, pi));
  assert.equal(pi.messages.length, 0);
});

test('fired reminder sends steer message with triggerTurn and escaped XML', async () => {
  const pi = fakePi();
  const ctx = fakeCtx(tempDir(), [{}]);
  const diagnostics = [];
  const reminders = [{
    name: 'bad"<name>',
    reminder: { on: 'turn_end', when: () => true, message: 'hello <world> & bye' },
    events: new Set(['turn_end']),
    evalCount: 0,
    lastFiredAt: -Infinity,
    fired: false,
    path: '/tmp/bad.ts',
  }];

  await mod.evaluate('turn_end', reminders, diagnostics, {}, ctx, pi);

  assert.equal(pi.messages.length, 1);
  assert.deepEqual(pi.messages[0].options, { deliverAs: 'steer', triggerTurn: true });
  assert.match(pi.messages[0].message.content, /name="bad&quot;&lt;name&gt;"/);
  assert.match(pi.messages[0].message.content, /hello &lt;world&gt; &amp; bye/);
  assert.deepEqual(pi.messages[0].message.details, { name: 'bad"<name>', message: 'hello <world> & bye' });
});

test('malformed reminder reports diagnostics', () => withAgentDir((agentDir) => {
  const cwd = tempDir();
  write(path.join(agentDir, 'reminders', 'broken.ts'), 'export default () => ({ on: "not_an_event", when: () => true, message: "x" });');

  const result = mod.loadReminders(fakePi(), cwd);

  assert.equal(result.reminders.length, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].phase, 'validate');
}));

test('runtime reminder errors report diagnostics', async () => {
  const pi = fakePi();
  const ctx = fakeCtx(tempDir(), [{}]);
  const diagnostics = [];
  const reminders = [{
    name: 'throws',
    reminder: { on: 'turn_end', when: () => { throw new Error('bad when'); }, message: 'hello' },
    events: new Set(['turn_end']),
    evalCount: 0,
    lastFiredAt: -Infinity,
    fired: false,
    path: '/tmp/throws.ts',
  }];

  await mod.evaluate('turn_end', reminders, diagnostics, {}, ctx, pi);

  assert.equal(pi.messages.length, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].phase, 'when');
} );

test('reminder factories are not loaded before session_start', async () => {
  await withAgentDir(async (agentDir) => {
  const cwd = tempDir();
  write(path.join(agentDir, 'reminders', 'hook.ts'), 'export default (pi) => { pi.on("tool_result", () => {}); return { on: "turn_end", when: () => false, message: "x" }; };');
  const pi = fakePi();
  const ctx = fakeCtx(cwd, [{}]);

  mod.default(pi);

  assert.equal(pi.handlers.get('tool_result')?.length ?? 0, 1, 'only extension handler exists before session_start');
  await pi.handlers.get('session_start')[0]({}, ctx);
  assert.equal(pi.handlers.get('tool_result').length, 2, 'reminder hook is added once during session_start');
  });
});
