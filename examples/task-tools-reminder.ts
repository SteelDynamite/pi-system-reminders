/**
 * Remind the agent to use task tracking tools if they haven't been used recently.
 * Mirrors Claude Code's system-reminder-task-tools-reminder.
 * Uses per-runtime closure state; not branch-aware after /tree, /fork, /clone, or /resume.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	let toolCallsSinceLastTask = 0;

	const taskToolNames = new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskExecute"]);

	pi.on("tool_result", async (event) => {
		if (taskToolNames.has(event.toolName)) {
			toolCallsSinceLastTask = 0;
		} else {
			toolCallsSinceLastTask++;
		}
	});

	return {
		on: "turn_end",
		when: () => toolCallsSinceLastTask >= 20,
		message: "The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using TaskCreate to add new tasks and TaskUpdate to update task status. Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user.",
		cooldown: 20,
	};
}
