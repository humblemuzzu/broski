// broski-host-extension v3: written by the Broski bridge for the `pi` processes it starts (`pi --mode rpc -e <this file>`).
//
// It never loads in a `pi` you start yourself. In the bridge's own `pi` it asks the phone before a tool runs when the
// session's permissions mode says so, writes the session records the bridge hands it (`broski.*` custom entries),
// passes on the background tasks other extensions announce (`broski:tasks` on Pi's event bus) and the questions they
// ask (`broski:questions`), gives the model its own way to ask them (the `broski_ask` tool), keeps the process on the
// one session the bridge opened it for, and tells the model how the phone draws answers: at the end of the system
// prompt of a session the phone starts, and as a message in one it takes over, so a session's system prompt never
// changes and its prompt cache stays warm.
import { getCurrentSystemMessage, type JsonObject, validateToolArguments } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	ToolCallEvent,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

const COMMAND = "broski-host";
const ASK_PREFIX = "broski-permission:";
const QUESTIONS_PREFIX = "broski-questions:";
/** The event bus channel an extension asks questions on (`docs/architecture/backends/pi/extension-hints.md`). */
const QUESTIONS = "broski:questions";
const RECORD_PREFIX = "broski.";
const PERMISSIONS = "broski.permissions";
/** The event bus channel an extension announces its background tasks on, and the status key that carries them out. */
const TASKS = "broski:tasks";
/** The flag the bridge passes its note in (`PROMPT_NOTE_FLAG` in `host/install.ts`), and the prompt section it fills. */
const PROMPT_NOTE_FLAG = "broski-prompt-note";
const PROMPT_NOTE_SECTION = "broski_phone";
/** The hidden message that carries the note into a session begun elsewhere. */
const PROMPT_NOTE_MESSAGE = "broski.phone_note";

/** The model's own questions tool. It asks nothing but the person, so it is never gated behind a permission ask. */
const ASK_TOOL = "broski_ask";
/** The bounds of `AskedQuestions` (`ui/questions-dialog.ts`) a model could break; past them the phone shows no card. */
const ASK_PARAMETERS = {
	type: "object",
	properties: {
		title: { type: "string" },
		questions: {
			type: "array",
			minItems: 1,
			maxItems: 20,
			items: {
				type: "object",
				properties: {
					question: { type: "string", minLength: 1 },
					header: { type: "string" },
					options: {
						type: "array",
						items: {
							type: "object",
							properties: { label: { type: "string", minLength: 1 }, description: { type: "string" } },
							required: ["label"],
						},
					},
					multiple: { type: "boolean" },
				},
				required: ["question"],
			},
		},
	},
	required: ["questions"],
} as const;

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

function field(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Another extension's questions, as one `input` dialog whose title carries them; the answer is the answers as JSON, and
 * no answer (a dismissal) is `undefined`. Claimed at once: in a session the bridge hosts, only the phone can answer.
 */
function askOnPhone(ui: ExtensionContext["ui"], request: unknown): void {
	const answer = field(request, "answer");
	const questions = field(request, "questions");
	if (typeof answer !== "function" || !Array.isArray(questions)) return;
	const claim = field(request, "claim");
	const title = field(request, "title");
	const signal = field(request, "signal");
	if (typeof claim === "function") claim();
	let text: string;
	try {
		text = `${QUESTIONS_PREFIX}${JSON.stringify({ ...(typeof title === "string" && { title }), questions })}`;
	} catch {
		answer(undefined);
		return;
	}
	void ui.input(text, undefined, signal instanceof AbortSignal ? { signal } : undefined).then(
		(reply) => answer(reply === undefined ? undefined : parsed(reply)),
		() => answer(undefined),
	);
}

/** The person's answers, in the questions' order, each with the question it answers. */
function askResult(questions: unknown, reply: string | undefined): JsonObject {
	const answers = reply === undefined ? undefined : parsed(reply);
	if (!Array.isArray(answers) || !Array.isArray(questions)) {
		return { status: "cancelled", message: "The user dismissed the questions." };
	}
	return {
		status: "answered",
		answers: answers.map((answer, index) => {
			const question = field(questions[index], "question");
			const selected = field(answer, "selected");
			const custom = field(answer, "custom");
			return {
				question: typeof question === "string" ? question : "",
				selected: Array.isArray(selected) ? selected.filter((label) => typeof label === "string") : [],
				...(typeof custom === "string" && { custom }),
			};
		}),
	};
}

function registerAsk(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ASK_TOOL,
		label: "Ask on the phone",
		description: "Ask the user questions on their phone and wait for the answers. Not for permissions.",
		parameters: ASK_PARAMETERS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const text = `${QUESTIONS_PREFIX}${JSON.stringify(params)}`;
			const reply = await ctx.ui.input(text, undefined, signal === undefined ? undefined : { signal });
			const result = askResult(field(params, "questions"), reply);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});
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
		const { toolName } = event;
		if (this.permissions.mode === "off" || toolName === ASK_TOOL || this.permissions.allowed.has(toolName))
			return undefined;
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

/**
 * The sections the session's system prompt already has, replayed from its system messages; undefined before its first
 * run. Each holds its rendered text, `<name>\n…\n</name>` (pi-coding-agent 1.5.2 `dist/core/system-prompt.js:114-118`).
 */
function recordedSections(ctx: ExtensionContext): Record<string, string | null> | undefined {
	const system = ctx.sessionManager
		.getBranch()
		.flatMap((entry) => (entry.type === "message" && entry.message.role === "system" ? [entry.message] : []));
	return system.length === 0 ? undefined : (getCurrentSystemMessage(system)?.sections ?? {});
}

/** A recorded section's own text, which Pi wraps again when the section is set. */
function sectionText(name: string, rendered: string): string | undefined {
	const open = `<${name}>\n`;
	const close = `\n</${name}>`;
	return rendered.startsWith(open) && rendered.endsWith(close) ? rendered.slice(open.length, -close.length) : undefined;
}

function noteSent(ctx: ExtensionContext): boolean {
	return ctx.sessionManager
		.getBranch()
		.some((entry) => entry.type === "custom_message" && entry.customType === PROMPT_NOTE_MESSAGE);
}

/**
 * A changed system prompt is a new prompt to the provider, so a session's cached conversation would be read again in
 * full. A session that has the note keeps it as recorded, a session the phone starts gets it, and a session begun
 * without it gets it once as a hidden message after the person's prompt.
 */
function placeNote(
	sections: Record<string, string>,
	ctx: ExtensionContext,
	note: string,
): { message: { customType: string; content: string; display: false } } | undefined {
	const recorded = recordedSections(ctx);
	const kept = recorded?.[PROMPT_NOTE_SECTION];
	const keptText = typeof kept === "string" ? sectionText(PROMPT_NOTE_SECTION, kept) : undefined;
	if (keptText !== undefined) {
		sections[PROMPT_NOTE_SECTION] = keptText;
		return undefined;
	}
	if (note === "") return undefined;
	if (recorded === undefined) {
		sections[PROMPT_NOTE_SECTION] = note;
		return undefined;
	}
	if (noteSent(ctx)) return undefined;
	return { message: { customType: PROMPT_NOTE_MESSAGE, content: note, display: false } };
}

export default function broskiHost(pi: ExtensionAPI): void {
	const gate = new PermissionGate(pi);
	let ui: ExtensionContext["ui"] | undefined;

	pi.on("session_start", (_event, ctx) => {
		ui = ctx.ui;
		gate.load(ctx.sessionManager.getEntries());
	});
	pi.events.on(TASKS, (tasks) => {
		try {
			ui?.setStatus(TASKS, JSON.stringify(tasks ?? []));
		} catch {
			// A list JSON cannot hold (a cycle) has nothing to pass on, and the extension that sent it must not see a throw.
		}
	});
	pi.events.on(QUESTIONS, (request) => {
		if (ui !== undefined) askOnPhone(ui, request);
	});
	pi.on("tool_call", (event, ctx) => gate.check(event, ctx));
	registerAsk(pi);

	pi.registerFlag(PROMPT_NOTE_FLAG, { description: "Used by the Broski bridge.", type: "string" });
	pi.on("before_agent_start", (event, ctx) => {
		const note = pi.getFlag(PROMPT_NOTE_FLAG);
		return placeNote(event.systemPromptOptions.sections, ctx, typeof note === "string" ? note : "");
	});

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
