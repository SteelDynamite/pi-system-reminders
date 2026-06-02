/**
 * Notify the agent when the model changes mid-session.
 */
import type { ExtensionAPI, ExtensionEvent } from "@earendil-works/pi-coding-agent";

type ModelSelectReminderEvent = Extract<ExtensionEvent, { type: "model_select" }>;

export default function (_pi: ExtensionAPI) {
	return {
		on: "model_select",
		when: ({ event }: { event: ModelSelectReminderEvent }) => event.previousModel != null,
		triggerTurn: false,
		message: ({ event }: { event: ModelSelectReminderEvent }) => {
			if (!event.previousModel) return "Model changed. Capabilities may differ — adjust your approach if needed.";
			const prev = `${event.previousModel.provider}/${event.previousModel.id}`;
			const next = `${event.model.provider}/${event.model.id}`;
			return `Model changed from ${prev} to ${next}. Capabilities may differ — adjust your approach if needed.`;
		},
	};
}
