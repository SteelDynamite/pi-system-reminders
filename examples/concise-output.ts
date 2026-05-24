/**
 * Remind the agent to keep responses short and concise.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI) {
	return {
		on: "agent_start",
		when: () => true,
		message: "Use as few words as possible to say what you want to say. Use only the detail needed to answer the user.",
		cooldown: 3,
	};
}
