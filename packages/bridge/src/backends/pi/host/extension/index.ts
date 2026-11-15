// broski-host-extension v1: written by the Broski bridge for the `pi` processes it starts (`pi --mode rpc -e <this file>`).
//
// It never loads in a `pi` you start yourself. In the bridge's own `pi` it asks the phone before a tool runs when the
// session's permissions mode says so, writes the session records the bridge hands it (`broski.*` custom entries),
// and keeps the process on the one session the bridge opened it for.
import { type JsonObject, validateToolArguments } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

const COMMAND = "broski-host";
const ASK_PREFIX = "broski-permission:";
const RECORD_PREFIX = "broski.";
const PERMISSIONS = "broski.permissions";

const UNANSWERED = "The permission request ended before it was answered.";
const DENIED = "The user denied this tool call.";
const FAULT = "The permission check failed, so the tool call was blocked.";

interface Permissions {
	mode: "off" | "ask";
	allowed: Set<string>;
}

type Verdict = { decision: "allow" | "allow_session"; input?: JsonObject } | { decision: "deny"; message?: string };

function permissionsOf(data: unknown): Permissions | undefined {
	if (typeof data !== "object" || data === null || !("mode" in data)) return undefined;
	const { mode } = data;
	if (mode !== "off" && mode !== "ask") return undefined;
	const tools = "allowedTools" in data && Array.isArray(data.allowedTools) ? data.allowedTools : [];
	return { mode, allowed: new Set(tools.filter((name): name is string => typeof name === "string")) };
}

function lastPermissions(entries: readonly SessionEntry[]): Permissions {
	for (let at = entries.length - 1; at >= 0; at--) {
		const entry = entries[at];
		const found = entry?.type === "custom" && entry.customType === PERMISSIONS ? permissionsOf(entry.data) : undefined;
		if (found) return found;
	}
	return { mode: "off", allowed: new Set() };
}

function parsed(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** For a value `JSON.parse` made, which holds nothing but JSON. */
function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function verdictOf(answer: string): Verdict | undefined {
	const value = parsed(answer);
	if (!isObject(value)) return undefined;
	const { decision, input, message } = value;
	if (decision === "deny") return { decision, ...(typeof message === "string" && { message }) };
	if (decision !== "allow" && decision !== "allow_session") return undefined;
	return isObject(input) ? { decision, input } : { decision };
}

/** Pi checks no input a `tool_call` handler edits, so an edit is checked here as Pi checks the model's own arguments. */
function checkedInput(pi: ExtensionAPI, event: ToolCallEvent, edited: JsonObject): Record<string, unknown> {
	const tool = pi.getAllTools().find((candidate) => candidate.name === event.toolName);
	if (tool === undefined) return edited;
	return validateToolArguments(tool, {
		type: "toolCall",
		id: event.toolCallId,
		name: event.toolName,
		arguments: edited,
	});
}

/** In place: the tool call holds this object, and a later handler or the tool itself reads it. */
function replaceInput(event: ToolCallEvent, input: Record<string, unknown>): void {
	for (const key of Object.keys(event.input)) Reflect.deleteProperty(event.input, key);
	Object.assign(event.input, input);
}

/** The session's permissions: what the phone is asked before a tool runs, and the records that change it. */
class PermissionGate {
	private permissions: Permissions = { mode: "off", allowed: new Set() };

	constructor(private readonly pi: ExtensionAPI) {}

	load(entries: readonly SessionEntry[]): void {
		this.permissions = lastPermissions(entries);
	}

	record(customType: string, data: unknown): void {
		if (customType === PERMISSIONS) this.permissions = permissionsOf(data) ?? this.permissions;
		this.pi.appendEntry(customType, data);
	}

	async check(event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
		if (this.permissions.mode === "off" || this.permissions.allowed.has(event.toolName)) return undefined;
		try {
			return await this.ask(event, ctx);
		} catch {
			return { block: true, reason: FAULT };
		}
	}

	private async ask(
		event: ToolCallEvent,
		ctx: ExtensionContext,
		problem?: string,
	): Promise<ToolCallEventResult | undefined> {
		const request = {
			toolCallId: event.toolCallId,
			parentToolCallId: event.parentToolCallId,
			toolName: event.toolName,
			input: event.input,
			cwd: ctx.cwd,
			problem,
		};
		const answer = await ctx.ui.input(`${ASK_PREFIX}${JSON.stringify(request)}`, undefined, { signal: ctx.signal });
		if (answer === undefined) return { block: true, reason: UNANSWERED };
		const verdict = verdictOf(answer);
		if (verdict === undefined) return { block: true, reason: FAULT };
		if (verdict.decision === "deny") return { block: true, reason: verdict.message?.trim() || DENIED };
		if (verdict.input !== undefined) {
			try {
				replaceInput(event, checkedInput(this.pi, event, verdict.input));
			} catch (error) {
				return this.ask(event, ctx, error instanceof Error ? error.message : String(error));
			}
		}
		if (verdict.decision === "allow_session" && !this.permissions.allowed.has(event.toolName)) {
			const allowedTools = [...this.permissions.allowed, event.toolName];
			this.record(PERMISSIONS, { mode: this.permissions.mode, allowedTools });
		}
		return undefined;
	}
}

export default function broskiHost(pi: ExtensionAPI): void {
	const gate = new PermissionGate(pi);

	pi.on("session_start", (_event, ctx) => gate.load(ctx.sessionManager.getEntries()));
	pi.on("tool_call", (event, ctx) => gate.check(event, ctx));

	pi.registerCommand(COMMAND, {
		description: "Used by the Broski bridge.",
		handler: async (args) => {
			const value = parsed(args);
			const customType = isObject(value) ? value.customType : undefined;
			if (!isObject(value) || typeof customType !== "string" || !customType.startsWith(RECORD_PREFIX)) {
				throw new Error("not a Broski record");
			}
			gate.record(customType, value.data);
		},
	});

	const stay = { cancel: true } as const;
	pi.on("session_before_switch", (_event, ctx) => {
		ctx.ui.notify("The phone keeps this session open here; start another one from the phone.", "warning");
		return stay;
	});
	pi.on("session_before_fork", (_event, ctx) => {
		ctx.ui.notify("The phone keeps this session open here; fork it from the phone.", "warning");
		return stay;
	});
}
