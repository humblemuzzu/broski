// `broski_ask` in a terminal that took up a session the phone started. That session declared the tool to the provider,
// so it keeps it here, with its tools as recorded and its prompt cache warm; a session that never declared it never
// gets it. The questions show in the terminal and on the phone, and the first answer wins.
//
// The bridge's own `pi` loads this extension beside the bridge's `broski_ask`, and Pi stops at startup when two
// extensions register one tool name as they load (pi-coding-agent 1.5.2 `core/resource-loader.js:599-608`,
// `main.js:767, 803-808`). So the tool is registered at session start, in the terminal only; a session's recorded
// tool that registers late is still activated (`core/agent-session.js:1471-1474, 3047`). Registering never activates
// it (`defaultActive: false`), so a branch whose recorded tools leave it out goes without it, and the tools Pi restored
// for that branch stay as they are (`core/agent-session.js:1178-1185, 1469`).
import { getCurrentTools, type JsonObject } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LocalDialogs, RemoteDialogs } from "./dialogs";
import { read } from "./projection";

const ASK_TOOL = "broski_ask";
const SOMETHING_ELSE = "Something else…";
const DONE = "Done";
/**
 * The bridge's own tool (`host/extension/index.ts`) to the character: Pi compares a tool's description and parameters
 * with the declaration the session recorded, and any difference is a new tool to the provider.
 */
const ASK_DESCRIPTION = "Ask the user questions on their phone and wait for the answers. Not for permissions.";
const ASK_PARAMETERS = {
	type: "object",
	properties: {
		title: { type: "string", maxLength: 1_024 },
		questions: {
			type: "array",
			minItems: 1,
			maxItems: 20,
			items: {
				type: "object",
				properties: {
					question: { type: "string", minLength: 1, maxLength: 1_048_576 },
					header: { type: "string", maxLength: 1_024 },
					options: {
						type: "array",
						maxItems: 1_000,
						items: {
							type: "object",
							properties: {
								label: { type: "string", minLength: 1, maxLength: 1_024 },
								description: { type: "string", maxLength: 1_048_576 },
							},
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

interface Answer {
	selected: string[];
	custom?: string;
}

interface Choice {
	readonly label: string;
	readonly shown: string;
}

function declaresAsk(ctx: ExtensionContext): boolean {
	const system = ctx.sessionManager
		.getBranch()
		.flatMap((entry) => (entry.type === "message" && entry.message.role === "system" ? [entry.message] : []));
	return getCurrentTools(system).some((tool) => tool.name === ASK_TOOL);
}

export class AskHandoff {
	private registered = false;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly dialogs: RemoteDialogs,
	) {}

	/**
	 * At each session start and move in the session's tree: the tool is active only where the branch declared it. A
	 * branch that records no tools keeps whatever was active (`core/agent-session.js:1460-1462`), so only there is it
	 * taken away, with no restored tool pending to lose.
	 */
	sync(ctx: ExtensionContext): void {
		const keep = ctx.mode === "tui" && declaresAsk(ctx);
		if (keep && !this.registered) {
			this.registered = true;
			this.register();
		}
		const active = this.pi.getActiveTools();
		if (keep && !active.includes(ASK_TOOL)) this.pi.setActiveTools([...active, ASK_TOOL]);
		else if (!keep && this.registered && active.includes(ASK_TOOL)) {
			this.pi.setActiveTools(active.filter((name) => name !== ASK_TOOL));
		}
	}

	private register(): void {
		this.pi.registerTool({
			name: ASK_TOOL,
			label: "Ask",
			description: ASK_DESCRIPTION,
			parameters: ASK_PARAMETERS,
			defaultActive: false,
			execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
				const asked = read(params, "questions");
				const questions = Array.isArray(asked) ? asked : [];
				const answers = await this.ask(read(params, "title"), questions, this.dialogs.here(ctx.ui), signal);
				const result = askResult(questions, answers);
				return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
			},
		});
	}

	/** The answers of whichever side answers first; the other side's dialog closes. */
	private async ask(
		title: unknown,
		questions: unknown[],
		here: LocalDialogs,
		signal: AbortSignal | undefined,
	): Promise<unknown[] | undefined> {
		const done = new AbortController();
		const ended = signal === undefined ? done.signal : AbortSignal.any([signal, done.signal]);
		try {
			return await Promise.race([askPhone(this.pi, title, questions, ended), askHere(here, questions, ended)]);
		} finally {
			done.abort();
		}
	}
}

/** On `broski:questions`, which this extension's link puts on the phone; never settles while no phone answers. */
function askPhone(
	pi: ExtensionAPI,
	title: unknown,
	questions: unknown[],
	signal: AbortSignal,
): Promise<unknown[] | undefined> {
	return new Promise((resolve) => {
		pi.events.emit("broski:questions", {
			...(typeof title === "string" && { title }),
			questions,
			signal,
			answer: (answers: unknown) => resolve(Array.isArray(answers) ? answers : undefined),
		});
	});
}

async function askHere(here: LocalDialogs, questions: unknown[], signal: AbortSignal): Promise<Answer[] | undefined> {
	const answers: Answer[] = [];
	for (const question of questions) {
		const answer = await askOne(here, question, signal);
		if (answer === undefined) return undefined;
		answers.push(answer);
	}
	return answers;
}

/** One question: a choice of its options, several when it allows them, or an answer of the person's own, typed. */
async function askOne(here: LocalDialogs, question: unknown, signal: AbortSignal): Promise<Answer | undefined> {
	const header = read(question, "header");
	const text = String(read(question, "question") ?? "");
	const title = typeof header === "string" && header !== "" ? `${header}: ${text}` : text;
	const listed = read(question, "options");
	const choices = (Array.isArray(listed) ? listed : []).map((option): Choice => {
		const label = String(read(option, "label") ?? "");
		const description = read(option, "description");
		return {
			label,
			shown: typeof description === "string" && description !== "" ? `${label} — ${description}` : label,
		};
	});
	if (choices.length === 0) return typed(here, title, [], signal);
	if (read(question, "multiple") === true) return pickMany(here, title, choices, signal);
	return pickOne(here, title, choices, signal);
}

/** `row`, made unlike every row in `taken`: an option may carry the very text of one of the picker's own rows. */
function unique(row: string, taken: readonly string[]): string {
	let free = row;
	while (taken.includes(free)) free = `${free} `;
	return free;
}

async function typed(
	here: LocalDialogs,
	title: string,
	selected: string[],
	signal: AbortSignal,
): Promise<Answer | undefined> {
	const custom = await here.input(title, undefined, { signal });
	return custom === undefined ? undefined : { selected, custom };
}

async function pickOne(
	here: LocalDialogs,
	title: string,
	choices: readonly Choice[],
	signal: AbortSignal,
): Promise<Answer | undefined> {
	const shown = choices.map((choice) => choice.shown);
	const other = unique(SOMETHING_ELSE, shown);
	const picked = await here.select(title, [...shown, other], { signal });
	if (picked === undefined) return undefined;
	if (picked === other) return typed(here, title, [], signal);
	const choice = choices.find((candidate) => candidate.shown === picked);
	return choice === undefined ? undefined : { selected: [choice.label] };
}

/** One option at a time, each picked one leaving the list, until `Done`; a typed answer ends it too. */
async function pickMany(
	here: LocalDialogs,
	title: string,
	choices: readonly Choice[],
	signal: AbortSignal,
): Promise<Answer | undefined> {
	const shown = choices.map((choice) => choice.shown);
	const done = unique(DONE, shown);
	const other = unique(SOMETHING_ELSE, [...shown, done]);
	const selected: string[] = [];
	let left = choices;
	for (;;) {
		const heading = selected.length === 0 ? title : `${title} (${selected.join(", ")})`;
		const picked = await here.select(heading, [...left.map((choice) => choice.shown), other, done], { signal });
		if (picked === undefined) return undefined;
		if (picked === done) return { selected };
		if (picked === other) return typed(here, title, selected, signal);
		const choice = left.find((candidate) => candidate.shown === picked);
		if (choice === undefined) return undefined;
		selected.push(choice.label);
		left = left.filter((candidate) => candidate !== choice);
	}
}

/** As the bridge's own tool answers the model: the answers in the questions' order, each with the question it answers. */
function askResult(questions: unknown[], answers: unknown[] | undefined): JsonObject {
	if (answers === undefined) return { status: "cancelled", message: "The user dismissed the questions." };
	return {
		status: "answered",
		answers: answers.map((answer, index) => {
			const question = read(questions[index], "question");
			const selected = read(answer, "selected");
			const custom = read(answer, "custom");
			return {
				question: typeof question === "string" ? question : "",
				selected: Array.isArray(selected) ? selected.filter((label) => typeof label === "string") : [],
				...(typeof custom === "string" && { custom }),
			};
		}),
	};
}
