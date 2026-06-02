# pi-system-reminders

Reactive system reminders for [pi](https://github.com/badlogic/pi-mono). Claude Code has them built-in — now pi does too.

No reminders are active by default. Install this extension, then copy or write reminder files in one of the discovery locations below.

Drop a `.ts` file in a folder, get a reactive reminder that watches conversation state and steers the agent when conditions are met. Same DX as pi extensions — export a default function, get the full `ExtensionAPI`.

## Install

```bash
pi install npm:pi-system-reminders
```

## Quick start

Create `.pi/reminders/bash-spiral.ts`:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let consecutiveFailures = 0;

  pi.on("tool_result", async (event) => {
    if (event.toolName === "bash") {
      consecutiveFailures = event.isError ? consecutiveFailures + 1 : 0;
    }
  });

  return {
    on: "tool_execution_end",
    when: () => consecutiveFailures >= 3,
    message: "3 consecutive bash failures. Stop and rethink.",
    cooldown: 10,
  };
}
```

Reload pi. After 3 failed bash calls, the agent sees:

```xml
<system-reminder name="bash-spiral">
3 consecutive bash failures. Stop and rethink.
</system-reminder>
```

## How it works

1. Extension discovers top-level `*.ts` files and one-level directory `index.ts` files from `~/.pi/agent/reminders/` (global) and `.pi/reminders/` (project-local).
2. Project reminders override global reminders with the same name.
3. Each file exports a default function receiving `ExtensionAPI` — same as pi extensions.
4. The function returns a reminder: an event to listen on, a predicate, and a message.
5. When the predicate returns true, a `<system-reminder>` steering message is injected into the conversation with `deliverAs: "steer"` and `triggerTurn: true`.

## Security

Reminder files are arbitrary TypeScript and execute with your user permissions. Only use reminders from repositories you trust. Review project-local `.pi/reminders/` before running pi in an untrusted repo.

## Discovery rules

Loaded paths:

- `~/.pi/agent/reminders/*.ts`
- `~/.pi/agent/reminders/*/index.ts`
- `.pi/reminders/*.ts`
- `.pi/reminders/*/index.ts`

Only top-level files and one-level `index.ts` directories are loaded. Nested files are ignored. If global and project reminders share a name, the project reminder wins.

Broken reminders are reported at startup. Run `/reminders` to list loaded reminders and diagnostics.

## Reminder shape

```typescript
export default function (pi: ExtensionAPI) {
  // Use pi.on() to track state, pi.exec() to run commands, etc.

  return {
    on: "tool_execution_end",           // event(s) to evaluate on
    when: ({ branch, ctx, event }) => boolean,  // fire?
    message: "text" | (rc) => "text",   // what to inject
    cooldown: 5,                        // skip N evaluations after firing
    once: true,                         // fire only once per session
  };
}
```

## Events

20 pi lifecycle events available:

| Event | When |
|-------|------|
| `agent_start` | Agent loop begins |
| `agent_end` | Agent loop ends |
| `tool_call` | Before tool executes |
| `tool_result` | After tool returns |
| `tool_execution_start` | Tool execution begins |
| `tool_execution_end` | Tool execution ends |
| `turn_start` | Before LLM call |
| `turn_end` | After turn completes |
| `message_start` | Message begins |
| `message_update` | Streaming update |
| `message_end` | Message complete |
| `model_select` | Model changed |
| `session_start` | Session begins |
| `session_before_switch` | Before session switch/new session |
| `session_before_fork` | Before fork/clone |
| `session_before_compact` | Before compaction |
| `session_compact` | After compaction |
| `session_before_tree` | Before tree navigation |
| `session_tree` | After tree navigation |
| `session_shutdown` | Session shutting down |

Use a string or array: `on: "tool_execution_end"` or `on: ["turn_start", "turn_end"]`.

## `when()` context

```typescript
when: ({ branch, ctx, event }) => {
  branch   // session branch entries
  ctx      // ExtensionContext (sessionManager, getContextUsage(), ui, etc.)
  event    // raw event data from pi
}
```

## Examples

Ready-to-use reminder examples live directly in `examples/`. Copy any example file into `.pi/reminders/` to activate it.

The examples are Claude-inspired and are not exact copies of Claude Code prompts unless noted.

| File | What it does |
|------|-------------|
| `background-subagents.ts` | Background subagent spawned → avoid duplicating its work |
| `bash-failed-truncated.ts` | Failed bash output was truncated → inspect full log if needed |
| `bash-spiral.ts` | 3 consecutive bash failures → stop and rethink |
| `concise-output.ts` | Remind the agent to keep final responses short |
| `context-large.ts` | Context > 150k tokens → suggest compacting |
| `external-file-modified.ts` | Warn when a file changed on disk after it was read |
| `file-churn.ts` | Same file edited 5+ times → step back |
| `file-empty.ts` | Read returned empty file → warn |
| `file-truncated.ts` | Read was truncated → use offset |
| `malware-awareness.ts` | After read → consider if content is malicious |
| `model-changed.ts` | Model switched → capabilities may differ |
| `new-diagnostics.ts` | Warn after diagnostic/test commands report failures |
| `post-compaction.ts` | After compaction → file contents may be lost |
| `prefer-edit.ts` | 3+ writes → use edit for surgical changes |
| `read-before-edit.ts` | Edit without read → warn about stale content |
| `session-location.ts` | First agent turn → report the active Pi session file |
| `session-resumed.ts` | Session resumed → state may have changed |
| `task-tools-reminder.ts` | 20 tool calls without tasks → gentle nudge |
| `token-usage.ts` | Over 50% context → show token stats |
| `truthful-reporting.ts` | Remind the agent to report failed/skipped verification honestly |
| `verify-plan.ts` | Remind the agent to verify completed task/plan work directly |

Some examples keep runtime state in closures. That state is per extension runtime and may not reflect branch changes after `/tree`, `/fork`, `/clone`, `/resume`, or compaction. Prefer deriving state from `ctx.sessionManager.getBranch()` when exact branch-aware behavior matters.

Use `agent_end` for checks after an agent prompt finishes. Use `message_end` for checks tied to each finalized message.

## Development

```bash
npm install
npm run typecheck
npm test
npm run test:pack
```
