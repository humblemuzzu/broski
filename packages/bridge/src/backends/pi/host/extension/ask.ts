// The questions the phone answers in the bridge's own `pi`: those another extension asks on `broski:questions`, and
// the model's own, through the `broski_ask` tool. Each reaches the phone as one `input` dialog whose title carries them.
import { getCurrentTools, type JsonObject } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The model's own questions tool. It asks nothing but the person, so it is never gated behind a permission ask. */
export const ASK_TOOL = "broski_ask";
const QUESTIONS_PREFIX = "broski-questions:";
/**
 * `AskedQuestions` of `ui/questions-dialog.ts`, bounds included (the contract's `MAX_TEXT_CHARS`, `MAX_NAME_CHARS` and
 * `MAX_LIST_ITEMS`), so Pi refuses a call the bridge could not read before it reaches the phone.
 */
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

type SystemMessages = Parameters<typeof getCurrentTools>[0];

export function parsed(text: string): unknown {
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
 * Another extension's questions; the answer is the answers as JSON, and no answer (a dismissal) is `undefined`.
 * Claimed at once: in a session the bridge hosts, only the phone can answer.
 */
export function askOnPhone(ui: ExtensionContext["ui"], request: unknown): void {
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

/** Registering never activates it (`offerAsk` does): a session's recorded tools say whether it has it. */
export function registerAsk(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ASK_TOOL,
		label: "Ask on the phone",
		description: "Ask the user questions on their phone and wait for the answers. Not for permissions.",
		parameters: ASK_PARAMETERS,
		defaultActive: false,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const text = `${QUESTIONS_PREFIX}${JSON.stringify(params)}`;
			const reply = await ctx.ui.input(text, undefined, signal === undefined ? undefined : { signal });
			const result = askResult(field(params, "questions"), reply);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		},
	});
}

/**
 * A session that has run declared its tools to the provider, and Pi records them (`toolsAdded`) and restores them; one
 * that ran without `broski_ask` (begun in a terminal, or before the tool existed) goes on without it, so its tools and
 * its cache stay. A new session takes it unless another extension's questions tool reaches the phone (`phoneAsk`). It
 * is only ever added: a call that drops a tool also drops the restored tools still to register (pi-coding-agent 1.5.2
 * `dist/core/agent-session.js:1178-1185`), such as an MCP server's that is still connecting.
 */
export function offerAsk(pi: ExtensionAPI, system: SystemMessages, phoneAsk: boolean): void {
	const wanted = system.length > 0 ? getCurrentTools(system).some((tool) => tool.name === ASK_TOOL) : !phoneAsk;
	const active = pi.getActiveTools();
	if (wanted && !active.includes(ASK_TOOL)) pi.setActiveTools([...active, ASK_TOOL]);
}
