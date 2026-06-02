/**
 * Show token usage when context exceeds 50% capacity.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI) {
	return {
		on: "turn_start",
		when: ({ ctx }: { ctx: ExtensionContext }) => {
			const usage = ctx.getContextUsage();
			if (!usage || usage.tokens == null) return false;
			return usage.tokens > usage.contextWindow * 0.5;
		},
		triggerTurn: false,
		message: ({ ctx }: { ctx: ExtensionContext }) => {
			const usage = ctx.getContextUsage();
			if (!usage || usage.tokens == null) return "Token usage is currently unavailable.";
			const remaining = usage.contextWindow - usage.tokens;
			return `Token usage: ${usage.tokens}/${usage.contextWindow}; ${remaining} remaining`;
		},
		cooldown: 10,
	};
}
