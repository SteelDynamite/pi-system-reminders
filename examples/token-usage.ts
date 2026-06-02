/**
 * Show token usage when context exceeds 50% capacity.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI) {
	return {
		on: "turn_start",
		when: ({ ctx }) => {
			const usage = ctx.getContextUsage();
			if (!usage) return false;
			return usage.tokens > usage.contextWindow * 0.5;
		},
		triggerTurn: false,
		message: ({ ctx }) => {
			const usage = ctx.getContextUsage()!;
			const remaining = usage.contextWindow - usage.tokens;
			return `Token usage: ${usage.tokens}/${usage.contextWindow}; ${remaining} remaining`;
		},
		cooldown: 10,
	};
}
