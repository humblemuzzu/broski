/**
 * The tools the MCP server offers, each behind one capability of its token. Their declarations are constants, so a
 * client lists the same bytes every time; the input schemas carry only what the model needs, and the bounds it could
 * break are checked here, answered as a tool error it can read and fix.
 */

import { z } from "zod";
import {
	MAX_ID_CHARS,
	MAX_LIST_ITEMS,
	MAX_NAME_CHARS,
	MAX_TEXT_CHARS,
	type Question,
	type QuestionOption,
	type SessionRef,
} from "../contract";
import type { McpCapability } from "./session-tokens";
import type { ExternalInteractionOutcome, McpBridgeSink } from "./sink";
import { phoneLine, phoneText } from "./text";

const MAX_TITLE_CHARS = 120;
const MAX_QUESTIONS = 10;
const MAX_NOTICE_BODY_CHARS = 500;

export type McpToolOutput =
	| { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
	| { readonly ok: false; readonly message: string };

export interface McpToolContext {
	readonly session: SessionRef;
	readonly sink: McpBridgeSink;
	readonly signal: AbortSignal;
}

export interface McpTool {
	readonly capability: McpCapability;
	/** It waits for the person, so its answer may take as long as they do. */
	readonly blocking: boolean;
	readonly declaration: Readonly<Record<string, unknown>>;
	call(args: unknown, context: McpToolContext): Promise<McpToolOutput>;
}

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false };
/** A client that defers tools behind a search would otherwise hide these. */
const META = { "anthropic/alwaysLoad": true };
const STRING = { type: "string" };
const BOOLEAN = { type: "boolean" };

const ENDED: Record<"withdrawn" | "expired", string> = {
	withdrawn: "It was withdrawn before the user answered.",
	expired: "It expired before the user answered.",
};
const DISMISSED = "The user dismissed it.";

function failure(message: string): McpToolOutput {
	return { ok: false, message };
}

function parsed<T>(schema: z.ZodType<T>, args: unknown): { readonly args: T } | McpToolOutput {
	const result = schema.safeParse(args);
	if (result.success) return { args: result.data };
	return failure(result.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
}

function cancelMessage(outcome: ExternalInteractionOutcome): string {
	if (outcome.kind === "ended") return ENDED[outcome.reason];
	return outcome.reply.kind === "cancel" && outcome.reply.message !== undefined ? outcome.reply.message : DISMISSED;
}

function declare(name: string, description: string, inputSchema: Record<string, unknown>) {
	return Object.freeze({ name, description, inputSchema, annotations: ANNOTATIONS, _meta: META });
}

const AskArguments = z.object({
	title: z.string().min(1).max(MAX_TITLE_CHARS),
	questions: z
		.array(
			z.object({
				id: z.string().min(1).max(MAX_ID_CHARS),
				header: z.string().max(MAX_NAME_CHARS).optional(),
				text: z.string().min(1).max(MAX_TEXT_CHARS),
				options: z
					.array(
						z.object({
							label: z.string().min(1).max(MAX_NAME_CHARS),
							description: z.string().max(MAX_TEXT_CHARS).optional(),
						}),
					)
					.max(MAX_LIST_ITEMS)
					.optional(),
				multiSelect: z.boolean().optional(),
				allowCustom: z.boolean().optional(),
				secret: z.boolean().optional(),
				required: z.boolean().optional(),
			}),
		)
		.min(1)
		.max(MAX_QUESTIONS),
});
type AskedQuestion = z.infer<typeof AskArguments>["questions"][number];

function optionsOf(asked: AskedQuestion): QuestionOption[] {
	return (asked.options ?? []).map((option) => ({
		label: phoneLine(option.label),
		...(option.description !== undefined && { description: phoneText(option.description) }),
	}));
}

function questionOf(asked: AskedQuestion): Question | string {
	const id = phoneLine(asked.id, MAX_ID_CHARS);
	const text = phoneText(asked.text);
	const options = optionsOf(asked);
	const allowCustom = asked.allowCustom ?? true;
	if (id === "" || text.trim() === "") return `question ${JSON.stringify(asked.id)}: id and text must be visible text`;
	if (options.some((option) => option.label === "")) return `question "${id}": every option label must be visible text`;
	if (new Set(options.map((option) => option.label)).size < options.length) {
		return `question "${id}": option labels must be distinct`;
	}
	if (options.length === 0 && !allowCustom) return `question "${id}": give options or allow a custom answer`;
	const header = asked.header === undefined ? "" : phoneLine(asked.header);
	return {
		id,
		...(header !== "" && { header }),
		text,
		options,
		multiSelect: asked.multiSelect ?? false,
		allowCustom,
		secret: asked.secret ?? false,
		required: asked.required ?? true,
	};
}

function questionsOf(asked: readonly AskedQuestion[]): Question[] | string {
	const questions: Question[] = [];
	for (const item of asked) {
		const question = questionOf(item);
		if (typeof question === "string") return question;
		if (questions.some((known) => known.id === question.id)) return `question ids must be distinct: "${question.id}"`;
		questions.push(question);
	}
	return questions;
}

function askAnswer(outcome: ExternalInteractionOutcome): McpToolOutput {
	if (outcome.kind === "answered" && outcome.reply.kind === "questions") {
		const answers = outcome.reply.answers.map((answer) => ({
			id: answer.questionId,
			selected: answer.selected,
			...(answer.custom !== undefined && answer.custom !== "" && { custom: answer.custom }),
		}));
		return { ok: true, value: { status: "answered", answers } };
	}
	return { ok: true, value: { status: "cancelled", message: cancelMessage(outcome) } };
}

const askTool: McpTool = {
	capability: "ask",
	blocking: true,
	declaration: declare("broski_ask", "Ask the user questions on their phone and wait. Not for permissions.", {
		type: "object",
		properties: {
			title: STRING,
			questions: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: STRING,
						header: STRING,
						text: STRING,
						options: {
							type: "array",
							items: { type: "object", properties: { label: STRING, description: STRING }, required: ["label"] },
						},
						multiSelect: BOOLEAN,
						allowCustom: BOOLEAN,
						secret: BOOLEAN,
						required: BOOLEAN,
					},
					required: ["id", "text"],
				},
			},
		},
		required: ["title", "questions"],
	}),
	async call(args, { session, sink, signal }) {
		const input = parsed(AskArguments, args);
		if (!("args" in input)) return input;
		const title = phoneLine(input.args.title, MAX_TITLE_CHARS);
		const questions = questionsOf(input.args.questions);
		if (title === "") return failure("title: must be visible text");
		if (typeof questions === "string") return failure(questions);
		const spec = {
			title,
			blocksRun: true,
			origin: { toolName: "broski_ask" },
			request: { kind: "questions", questions },
		} as const;
		return askAnswer(await sink.raiseExternalInteraction(session, spec, signal));
	},
};

const PlanArguments = z.object({
	title: z.string().min(1).max(MAX_TITLE_CHARS),
	plan: z.string().min(1).max(MAX_TEXT_CHARS),
});

function planAnswer(outcome: ExternalInteractionOutcome): McpToolOutput {
	if (outcome.kind === "answered" && outcome.reply.kind === "plan_approval") {
		const { decision, plan, feedback } = outcome.reply;
		return {
			ok: true,
			value: { decision, ...(plan !== undefined && { plan }), ...(feedback !== undefined && { feedback }) },
		};
	}
	return { ok: true, value: { decision: "cancelled", message: cancelMessage(outcome) } };
}

const planTool: McpTool = {
	capability: "plan",
	blocking: true,
	declaration: declare("broski_propose_plan", "Get the user's approval of a Markdown plan on their phone.", {
		type: "object",
		properties: { title: STRING, plan: STRING },
		required: ["title", "plan"],
	}),
	async call(args, { session, sink, signal }) {
		const input = parsed(PlanArguments, args);
		if (!("args" in input)) return input;
		const title = phoneLine(input.args.title, MAX_TITLE_CHARS);
		if (title === "") return failure("title: must be visible text");
		const spec = {
			title,
			blocksRun: true,
			origin: { toolName: "broski_propose_plan" },
			request: { kind: "plan_approval", plan: phoneText(input.args.plan), editable: true },
		} as const;
		return planAnswer(await sink.raiseExternalInteraction(session, spec, signal));
	},
};

const NotifyArguments = z.object({
	title: z.string().min(1).max(MAX_TITLE_CHARS),
	body: z.string().max(MAX_NOTICE_BODY_CHARS).optional(),
	urgency: z.enum(["normal", "high"]).optional(),
});

const notifyTool: McpTool = {
	capability: "notify",
	blocking: false,
	declaration: declare("broski_notify", "Send the user's phone a short update. Does not wait.", {
		type: "object",
		properties: { title: STRING, body: STRING, urgency: { enum: ["normal", "high"] } },
		required: ["title"],
	}),
	async call(args, { session, sink }) {
		const input = parsed(NotifyArguments, args);
		if (!("args" in input)) return input;
		const title = phoneLine(input.args.title, MAX_TITLE_CHARS);
		const body = phoneText(input.args.body ?? "").trim();
		if (title === "") return failure("title: must be visible text");
		const text = body === "" ? title : `${title}\n${body}`;
		const sent = await sink.emitExternalNotice(session, { level: "info", text, urgent: input.args.urgency === "high" });
		return sent.status === "accepted" ? { ok: true, value: { sent: true } } : failure(sent.rejection.message);
	},
};

const TOOLS: readonly McpTool[] = [askTool, planTool, notifyTool];

/** The tools a token's capabilities give, always in the same order. */
export function toolsOf(capabilities: readonly McpCapability[]): readonly McpTool[] {
	return Object.freeze(TOOLS.filter((tool) => capabilities.includes(tool.capability)));
}

export function toolNamed(tools: readonly McpTool[], name: unknown): McpTool | undefined {
	return tools.find((tool) => tool.declaration.name === name);
}
