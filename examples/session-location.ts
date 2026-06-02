/**
 * Report the active Pi session file once at startup.
 *
 * session_start gives the agent the path before work begins. agent_start is a
 * fallback for runtimes where the session file is not available at startup.
 * It stays quiet on /reload and /resume so old sessions are not re-announced.
 * triggerTurn: false avoids starting a pre-prompt or extra follow-up turn.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI) {
	let suppressFallback = false;

	return {
		on: ["session_start", "agent_start"],
		once: true,
		triggerTurn: false,
		when: ({ ctx, event }) => {
			if (event && "reason" in event) {
				suppressFallback = event.reason === "reload" || event.reason === "resume";
				if (suppressFallback) return false;
			}
			if (suppressFallback) return false;
			return Boolean(ctx.sessionManager.getSessionFile?.());
		},
		message: ({ ctx }) => `Current Pi session file: ${ctx.sessionManager.getSessionFile()}`,
	};
}
