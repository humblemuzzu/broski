// `broski_ask` in a terminal that took up a session the phone started. That session declared the tool to the provider,
// so it keeps it here, with its tools as recorded and its prompt cache warm; a session that never declared it never
// gets it. The questions show in the terminal and on the phone, and the first answer wins.
//
// The bridge's own `pi` loads this extension beside the bridge's `broski_ask`, and Pi stops at startup when two
// extensions register one tool name as they load (pi-coding-agent 1.5.2 `core/resource-loader.js:599-608`,
// `main.js:767, 803-808`). So the tool is registered at session start, in the terminal only; a session's recorded
// tool that registers late is still activated (`core/agent-session.js:1471-1474, 3047`).
import { getCurrentTools, type JsonObject } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LocalDialogs, RemoteDialogs } from "./dialogs";
import { read } from "./projection";

const ASK_TOOL = "broski_ask";
const SOMETHING_ELSE = "Something else…";
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

	/** At each session start and move in the session's tree: the tool is active only where the branch declared it. */
	sync(ctx: ExtensionContext): void {
		const keep = ctx.mode === "tui" && declaresAsk(ctx);
		if (keep && !this.registered) {
			this.registered = true;
			this.register();
		} else if (!keep && this.registered) {
			this.pi.setActiveTools(this.pi.getActiveTools().filter((name) => name !== ASK_TOOL));
		}
	}

	private register(): void {
		this.pi.registerTool({
			name: ASK_TOOL,
			label: "Ask",
			description: ASK_DESCRIPTION,
			parameters: ASK_PARAMETERS,
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

/** One question: a choice of its options or an answer of the person's own, typed. */
async function askOne(here: LocalDialogs, question: unknown, signal: AbortSignal): Promise<Answer | undefined> {
	const header = read(question, "header");
	const text = String(read(question, "question") ?? "");
	const title = typeof header === "string" && header !== "" ? `${header}: ${text}` : text;
	const listed = read(question, "options");
	const choices = (Array.isArray(listed) ? listed : []).map((option) => {
		const label = String(read(option, "label") ?? "");
		const description = read(option, "description");
		return {
			label,
			shown: typeof description === "string" && description !== "" ? `${label} — ${description}` : label,
		};
	});
	if (choices.length > 0) {
		const picked = await here.select(title, [...choices.map((choice) => choice.shown), SOMETHING_ELSE], { signal });
		if (picked === undefined) return undefined;
		const choice = choices.find((candidate) => candidate.shown === picked);
		if (choice !== undefined) return { selected: [choice.label] };
	}
	const custom = await here.input(title, undefined, { signal });
	return custom === undefined ? undefined : { selected: [], custom };
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
