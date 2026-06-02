/**
 * Report the active Pi session file once, when the first agent turn starts.
 *
 * Using agent_start avoids making the agent speak before the first user prompt.
 * A session_start reminder can intentionally start the agent first because normal
 * reminders inject with triggerTurn while pi is idle.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI) {
	return {
		on: "agent_start",
		once: true,
		when: ({ ctx }) => Boolean(ctx.sessionManager.getSessionFile()),
		message: ({ ctx }) => `Current Pi session file: ${ctx.sessionManager.getSessionFile()}`,
	};
}
