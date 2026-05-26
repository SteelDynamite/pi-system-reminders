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

function writeProjectReminder(cwd, source, name = 'example.ts') {
  write(path.join(cwd, '.pi', 'reminders', name), source);
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

test('skips reminder discovery paths that are files', () => withAgentDir((agentDir) => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(agentDir, 'reminders'), 'not a directory');
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
  assert.match(result.reminders[0].path.replace(/\\/g, '/'), /\.pi\/reminders\/same\.ts$/);
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
});

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

test('does not read the branch when no reminders match the event', () => withAgentDir(async () => {
  const cwd = tempDir();
  writeProjectReminder(cwd, `
    export default () => ({
      on: "tool_call",
      when: () => true,
      message: "tool reminder",
    });
  `);
  const pi = fakePi();
  mod.default(pi);

  const ctx = {
    cwd,
    ui: { notify() {} },
    sessionManager: {
      getBranch() {
        throw new Error('getBranch should not be called');
      },
    },
  };

  await pi.handlers.get('session_start')[0]({}, ctx);
  await pi.handlers.get('message_end')[0]({}, ctx);

  assert.equal(pi.messages.length, 0);
}));

test('skips matching reminders when branch lookup is unavailable', () => withAgentDir(async () => {
  const cwd = tempDir();
  writeProjectReminder(cwd, `
    export default () => ({
      on: "message_end",
      when: () => true,
      message: "message reminder",
    });
  `);
  const pi = fakePi();
  mod.default(pi);

  const ctx = {
    cwd,
    ui: { notify() {} },
    sessionManager: {
      getBranch() {
        throw new Error('branch unavailable');
      },
    },
  };

  await pi.handlers.get('session_start')[0]({}, ctx);
  await pi.handlers.get('message_end')[0]({}, ctx);

  assert.equal(pi.messages.length, 0);
}));

test('fires a matching reminder when branch lookup succeeds', () => withAgentDir(async () => {
  const cwd = tempDir();
  writeProjectReminder(cwd, `
    export default () => ({
      on: "message_end",
      when: ({ branch, event }) => branch[0].role === "user" && event.done === true,
      message: ({ branch }) => "branch length " + branch.length,
    });
  `);
  const pi = fakePi();
  mod.default(pi);

  let getBranchCalls = 0;
  const ctx = {
    cwd,
    ui: { notify() {} },
    sessionManager: {
      getBranch() {
        getBranchCalls++;
        return [{ role: 'user', content: 'hello' }];
      },
    },
  };

  await pi.handlers.get('session_start')[0]({}, ctx);
  await pi.handlers.get('message_end')[0]({ done: true }, ctx);

  assert.equal(getBranchCalls, 1);
  assert.equal(pi.messages.length, 1);
  assert.match(pi.messages[0].message.content, /<system-reminder name="example">\nbranch length 1\n<\/system-reminder>/);
  assert.deepEqual(pi.messages[0].options, { deliverAs: 'steer', triggerTurn: true });
}));

test('evaluates only reminders matching the current event', () => withAgentDir(async () => {
  const cwd = tempDir();
  writeProjectReminder(cwd, `
    export default () => [
      {
        on: "message_end",
        when: () => true,
        message: "matching reminder",
      },
      {
        on: "tool_call",
        when: () => { throw new Error("non-matching reminder should not run"); },
        message: "non-matching reminder",
      },
    ];
  `);
  const pi = fakePi();
  mod.default(pi);

  const ctx = {
    cwd,
    ui: { notify() {} },
    sessionManager: {
      getBranch() {
        return [];
      },
    },
  };

  await pi.handlers.get('session_start')[0]({}, ctx);
  await pi.handlers.get('message_end')[0]({}, ctx);

  assert.equal(pi.messages.length, 1);
  assert.match(pi.messages[0].message.content, /matching reminder/);
  assert.doesNotMatch(pi.messages[0].message.content, /non-matching reminder/);
}));

async function runExampleReminder(exampleName, toolResultEvent) {
  const pi = fakePi();
  const factory = jiti(`../examples/${exampleName}.ts`).default;
  const reminder = factory(pi);
  const loaded = {
    name: exampleName,
    reminder,
    events: new Set([reminder.on]),
    evalCount: 0,
    lastFiredAt: -Infinity,
    fired: false,
    path: `/tmp/${exampleName}.ts`,
  };
  const ctx = fakeCtx(tempDir(), [{}]);
  const diagnostics = [];

  for (const handler of pi.handlers.get('tool_result') ?? []) {
    await handler(toolResultEvent, ctx);
  }
  await mod.evaluate('tool_execution_end', [loaded], diagnostics, { toolName: toolResultEvent.toolName }, ctx, pi);

  return { pi, diagnostics };
}

test('background-subagents fires after successful background Agent spawn', async () => {
  const { pi, diagnostics } = await runExampleReminder('background-subagents', {
    type: 'tool_result',
    toolName: 'Agent',
    toolCallId: '1',
    input: { prompt: 'Find auth files', description: 'Find auth', subagent_type: 'Explore', run_in_background: true },
    content: [{ type: 'text', text: 'Agent started in background.' }],
    details: { status: 'background', agentId: 'agent-1' },
    isError: false,
  });

  assert.equal(diagnostics.length, 0);
  assert.equal(pi.messages.length, 1);
  assert.match(pi.messages[0].message.content, /background subagents/);
  assert.match(pi.messages[0].message.content, /Avoid duplicating their work/);
  assert.match(pi.messages[0].message.content, /get_subagent_result/);
});

test('background-subagents ignores foreground Agent spawn', async () => {
  const { pi } = await runExampleReminder('background-subagents', {
    type: 'tool_result',
    toolName: 'Agent',
    toolCallId: '1',
    input: { prompt: 'Find auth files', description: 'Find auth', subagent_type: 'Explore', run_in_background: false },
    content: [{ type: 'text', text: 'Agent completed.' }],
    details: { status: 'completed' },
    isError: false,
  });

  assert.equal(pi.messages.length, 0);
});

test('background-subagents ignores failed background Agent spawn', async () => {
  const { pi } = await runExampleReminder('background-subagents', {
    type: 'tool_result',
    toolName: 'Agent',
    toolCallId: '1',
    input: { prompt: 'Find auth files', description: 'Find auth', subagent_type: 'Explore', run_in_background: true },
    content: [{ type: 'text', text: 'Agent failed.' }],
    details: undefined,
    isError: true,
  });

  assert.equal(pi.messages.length, 0);
});

test('bash-failed-truncated fires on failed bash with truncation details', async () => {
  const { pi, diagnostics } = await runExampleReminder('bash-failed-truncated', {
    type: 'tool_result',
    toolName: 'bash',
    toolCallId: '1',
    input: { command: 'npm test' },
    content: [{ type: 'text', text: 'tail output' }],
    details: { truncation: { truncated: true }, fullOutputPath: '/tmp/pi-bash.log' },
    isError: true,
  });

  assert.equal(diagnostics.length, 0);
  assert.equal(pi.messages.length, 1);
  assert.match(pi.messages[0].message.content, /Bash output was truncated and the command failed/);
  assert.match(pi.messages[0].message.content, /Full output: \/tmp\/pi-bash\.log/);
});

test('bash-failed-truncated fires on failed bash with full output marker', async () => {
  const { pi } = await runExampleReminder('bash-failed-truncated', {
    type: 'tool_result',
    toolName: 'bash',
    toolCallId: '1',
    input: { command: 'npm test' },
    content: [{ type: 'text', text: 'tail\n[Showing lines 1-2 of 3. Full output: C:\\Temp\\pi-bash.log]' }],
    details: undefined,
    isError: true,
  });

  assert.equal(pi.messages.length, 1);
  assert.match(pi.messages[0].message.content, /C:\\Temp\\pi-bash\.log/);
});

test('bash-failed-truncated ignores successful truncated bash', async () => {
  const { pi } = await runExampleReminder('bash-failed-truncated', {
    type: 'tool_result',
    toolName: 'bash',
    toolCallId: '1',
    input: { command: 'printf lots' },
    content: [{ type: 'text', text: '[Showing lines 1-2 of 3. Full output: /tmp/pi-bash.log]' }],
    details: { truncation: { truncated: true }, fullOutputPath: '/tmp/pi-bash.log' },
    isError: false,
  });

  assert.equal(pi.messages.length, 0);
});

test('bash-failed-truncated ignores normal failed bash', async () => {
  const { pi } = await runExampleReminder('bash-failed-truncated', {
    type: 'tool_result',
    toolName: 'bash',
    toolCallId: '1',
    input: { command: 'false' },
    content: [{ type: 'text', text: 'Command exited with code 1' }],
    details: undefined,
    isError: true,
  });

  assert.equal(pi.messages.length, 0);
});
