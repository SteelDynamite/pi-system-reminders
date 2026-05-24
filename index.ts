// Pi System Reminders Extension
// Discovers reminder files from agent dir and project-local .pi/reminders/.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createJiti } from "jiti";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(__filename, { moduleCache: false });

export type ReminderEvent =
	| "agent_start"
	| "agent_end"
	| "tool_call"
	| "tool_result"
	| "tool_execution_start"
	| "tool_execution_end"
	| "turn_start"
	| "turn_end"
	| "message_start"
	| "message_update"
	| "message_end"
	| "model_select"
	| "session_start"
	| "session_before_switch"
	| "session_before_fork"
	| "session_before_compact"
	| "session_compact"
	| "session_before_tree"
	| "session_tree"
	| "session_shutdown";

const REMINDER_EVENTS: ReadonlySet<string> = new Set([
	"agent_start",
	"agent_end",
	"tool_call",
	"tool_result",
	"tool_execution_start",
	"tool_execution_end",
	"turn_start",
	"turn_end",
	"message_start",
	"message_update",
	"message_end",
	"model_select",
	"session_start",
	"session_before_switch",
	"session_before_fork",
	"session_before_compact",
	"session_compact",
	"session_before_tree",
	"session_tree",
	"session_shutdown",
]);

export interface ReminderContext {
	branch: any[];
	ctx: ExtensionContext;
	event: any;
}

export interface Reminder {
	on: ReminderEvent | ReminderEvent[];
	when: (rc: ReminderContext) => boolean | Promise<boolean>;
	message: string | ((rc: ReminderContext) => string);
	cooldown?: number;
	once?: boolean;
}

type ReminderFactory = (pi: ExtensionAPI) => Reminder | Reminder[];

export interface LoadedReminder {
	name: string;
	reminder: Reminder;
	events: Set<ReminderEvent>;
	evalCount: number;
	lastFiredAt: number;
	fired: boolean;
	path: string;
}

export interface ReminderDiagnostic {
	name: string;
	path?: string;
	phase: "load" | "validate" | "when" | "message";
	message: string;
}

export interface ReminderLoadResult {
	reminders: LoadedReminder[];
	diagnostics: ReminderDiagnostic[];
}

export function discoverReminderFiles(cwd: string): { path: string; name: string }[] {
	const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	const dirs = [
		path.join(agentDir, "reminders"),
		path.join(cwd, ".pi", "reminders"),
	];

	const results: { path: string; name: string }[] = [];

	for (const dir of dirs) {
		if (!fs.existsSync(dir)) continue;

		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isFile() && entry.name.endsWith(".ts")) {
				results.push({
					path: fullPath,
					name: entry.name.replace(/\.ts$/, ""),
				});
			} else if (entry.isDirectory()) {
				const indexPath = path.join(fullPath, "index.ts");
				if (fs.existsSync(indexPath)) {
					results.push({ path: indexPath, name: entry.name });
				}
			}
		}
	}

	// Later scopes override earlier scopes: project reminders override global reminders.
	const byName = new Map<string, { path: string; name: string }>();
	for (const r of results) {
		byName.set(r.name, r);
	}
	return Array.from(byName.values());
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function validateReminder(name: string, filePath: string, reminder: any): ReminderDiagnostic | undefined {
	if (!reminder || typeof reminder !== "object") {
		return { name, path: filePath, phase: "validate", message: "Reminder must be an object." };
	}
	const events: unknown[] = Array.isArray(reminder.on) ? reminder.on : [reminder.on];
	if (events.length === 0 || events.some((event: unknown) => typeof event !== "string" || !REMINDER_EVENTS.has(event))) {
		return { name, path: filePath, phase: "validate", message: `Invalid reminder event: ${events.join(", ")}` };
	}
	if (typeof reminder.when !== "function") {
		return { name, path: filePath, phase: "validate", message: "Reminder must define when(rc)." };
	}
	if (typeof reminder.message !== "string" && typeof reminder.message !== "function") {
		return { name, path: filePath, phase: "validate", message: "Reminder must define a string or function message." };
	}
	return undefined;
}

export function loadReminders(pi: ExtensionAPI, cwd: string): ReminderLoadResult {
	const reminders: LoadedReminder[] = [];
	const diagnostics: ReminderDiagnostic[] = [];
	const files = discoverReminderFiles(cwd);

	for (const file of files) {
		try {
			const mod = jiti(file.path) as any;
			const factory: ReminderFactory = mod.default;

			if (typeof factory !== "function") {
				diagnostics.push({ name: file.name, path: file.path, phase: "validate", message: "Reminder module must export a default function." });
				continue;
			}

			const result = factory(pi);
			const items = Array.isArray(result) ? result : [result];

			for (let i = 0; i < items.length; i++) {
				const r = items[i];
				const name = items.length > 1 ? `${file.name}[${i}]` : file.name;
				const diagnostic = validateReminder(name, file.path, r);
				if (diagnostic) {
					diagnostics.push(diagnostic);
					continue;
				}

				const events = new Set((Array.isArray(r.on) ? r.on : [r.on]) as ReminderEvent[]);

				reminders.push({
					name,
					reminder: r,
					events,
					evalCount: 0,
					lastFiredAt: -Infinity,
					fired: false,
					path: file.path,
				});
			}
		} catch (err: unknown) {
			diagnostics.push({ name: file.name, path: file.path, phase: "load", message: errorMessage(err) });
		}
	}

	return { reminders, diagnostics };
}

export function escapeXmlAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function escapeXmlContent(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export async function evaluate(
	event: ReminderEvent,
	reminders: LoadedReminder[],
	diagnostics: ReminderDiagnostic[],
	eventData: any,
	ctx: ExtensionContext,
	pi: ExtensionAPI,
) {
	const eventReminders = reminders.filter((loaded) => loaded.events.has(event));
	if (eventReminders.length === 0) return;

	let branch: any[];
	try {
		branch = ctx.sessionManager.getBranch();
	} catch {
		return;
	}

	for (const loaded of eventReminders) {
		loaded.evalCount++;

		if (loaded.reminder.once && loaded.fired) continue;

		const cooldown = loaded.reminder.cooldown ?? 0;
		if (loaded.evalCount - loaded.lastFiredAt <= cooldown) continue;

		const rc: ReminderContext = { branch, ctx, event: eventData };
		let shouldFire = false;
		try {
			shouldFire = await loaded.reminder.when(rc);
		} catch (err: unknown) {
			diagnostics.push({ name: loaded.name, path: loaded.path, phase: "when", message: errorMessage(err) });
			continue;
		}

		if (!shouldFire) continue;

		let message: string;
		try {
			message = typeof loaded.reminder.message === "function"
				? loaded.reminder.message(rc)
				: loaded.reminder.message;
		} catch (err: unknown) {
			diagnostics.push({ name: loaded.name, path: loaded.path, phase: "message", message: errorMessage(err) });
			continue;
		}

		pi.sendMessage(
			{
				customType: "system-reminder",
				content: `<system-reminder name="${escapeXmlAttribute(loaded.name)}">\n${escapeXmlContent(message)}\n</system-reminder>`,
				display: true,
				details: { name: loaded.name, message },
			},
			{ deliverAs: "steer", triggerTurn: true },
		);

		loaded.lastFiredAt = loaded.evalCount;
		loaded.fired = true;
	}
}

function formatDiagnostics(diagnostics: ReminderDiagnostic[]): string {
	return diagnostics
		.map((d) => `- ${d.name} (${d.phase})${d.path ? ` ${d.path}` : ""}: ${d.message}`)
		.join("\n");
}

export default function (pi: ExtensionAPI) {
	let reminders: LoadedReminder[] = [];
	let diagnostics: ReminderDiagnostic[] = [];

	pi.registerCommand?.("reminders", {
		description: "Show loaded system reminders and reminder diagnostics",
		handler: async (_args: string, ctx: ExtensionContext) => {
			const loadedLines = reminders.length > 0
				? reminders.map((r) => `- ${r.name}: ${Array.from(r.events).join(", ")}`).join("\n")
				: "No reminders loaded.";
			const diagnosticLines = diagnostics.length > 0 ? `\n\nDiagnostics:\n${formatDiagnostics(diagnostics)}` : "";
			ctx.ui.notify(`System reminders:\n${loadedLines}${diagnosticLines}`, diagnostics.length > 0 ? "warning" : "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const result = loadReminders(pi, ctx.cwd);
		reminders = result.reminders;
		diagnostics = result.diagnostics;

		if (reminders.length > 0) {
			ctx.ui.notify(`Loaded ${reminders.length} reminder(s)`, "info");
		}
		if (diagnostics.length > 0) {
			ctx.ui.notify(`Failed to load ${diagnostics.length} reminder(s). Run /reminders for details.`, "warning");
		}

		await evaluate("session_start", reminders, diagnostics, _event, ctx, pi);
	});

	pi.on("before_agent_start", async (event) => {
		if (reminders.length === 0) return;
		return {
			systemPrompt: event.systemPrompt + `\n\n## System reminders\n\nYou may receive <system-reminder> messages during the conversation. These are reactive, contextual guidance injected automatically based on conversation state. Follow their instructions. Do not mention them to the user unless they ask.`,
		};
	});

	const handle = (event: ReminderEvent) =>
		async (eventData: any, ctx: ExtensionContext) => {
			await evaluate(event, reminders, diagnostics, eventData, ctx, pi);
		};

	pi.on("agent_start", handle("agent_start"));
	pi.on("agent_end", handle("agent_end"));
	pi.on("tool_call", handle("tool_call"));
	pi.on("tool_result", handle("tool_result"));
	pi.on("tool_execution_start", handle("tool_execution_start"));
	pi.on("tool_execution_end", handle("tool_execution_end"));
	pi.on("turn_start", handle("turn_start"));
	pi.on("turn_end", handle("turn_end"));
	pi.on("message_start", handle("message_start"));
	pi.on("message_update", handle("message_update"));
	pi.on("message_end", handle("message_end"));
	pi.on("model_select", handle("model_select"));
	pi.on("session_before_switch", handle("session_before_switch"));
	pi.on("session_before_fork", handle("session_before_fork"));
	pi.on("session_before_compact", handle("session_before_compact"));
	pi.on("session_compact", handle("session_compact"));
	pi.on("session_before_tree", handle("session_before_tree"));
	pi.on("session_tree", handle("session_tree"));
	pi.on("session_shutdown", handle("session_shutdown"));
}
