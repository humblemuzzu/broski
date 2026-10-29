import {
	answerProblem,
	type FormFieldSpec,
	type FormValue,
	Interaction,
	InteractionAnswer,
	type InteractionKind,
	type InteractionReply,
	type InteractionRequest,
	type JsonValue,
	type StringField,
} from "../../src/contract";
import { invalidReplies, validReply } from "../../src/contract/testing/example-replies";
import { sampleRequest } from "../../src/contract/testing/fake-scenarios";
import { answerEdgeCases } from "./answer-edge-cases";
import { type AnswerInput, PERMISSION } from "./answer-input";
import {
	BLANK_INPUTS,
	DATE_INPUTS,
	DATE_TIME_INPUTS,
	EMAIL_INPUTS,
	IDNA_HOST_INPUTS,
	LENGTH_INPUTS,
	PATTERN_INPUTS,
	URI_INPUTS,
} from "./answer-inputs";
import { fieldActivityCases } from "./field-activity-cases";

const KINDS: readonly InteractionKind[] = [
	"tool_permission",
	"questions",
	"form",
	"plan_approval",
	"external_url",
	"choice",
	"confirm",
	"text",
];

/**
 * Answers for the app to check against the contract's own `answerProblem`, each with the problem
 * the contract finds (or null), `fieldIsActive` cases with the activity it computes, and non-ASCII
 * hosts with what `URL.canParse` says of them. Every expectation is computed here, on exactly the
 * JSON the fixture holds; none is written by hand.
 */
export function answerCases(): { answers: JsonValue[]; activity: JsonValue[]; idnaHosts: JsonValue[] } {
	const inputs = [...kindMatrix(), ...answerEdgeCases(), ...stringFieldCases()];
	const names = new Set(inputs.map((input) => input.name));
	if (names.size !== inputs.length) throw new Error("two answer cases share a name");
	const answers = inputs.map((input) => {
		const interaction = Interaction.parse(
			asJson({ id: "i-1", runId: "r-1", createdAt: 1, title: "Asked", blocksRun: true, request: input.request }),
		);
		const given = { interactionId: input.interactionId ?? "i-1", reply: input.reply };
		const answer = input.beyondTheWire ? given : InteractionAnswer.parse(asJson(given));
		return asJson({ name: input.name, interaction, answer, problem: answerProblem(interaction, answer) ?? null });
	});
	const idnaHosts = IDNA_HOST_INPUTS.map((input) => ({ input, canParse: URL.canParse(input) }));
	return { answers, activity: fieldActivityCases(), idnaHosts };
}

function requestOf(kind: InteractionKind): InteractionRequest {
	return kind === "tool_permission" ? PERMISSION : sampleRequest(kind);
}

/** Every request kind with a valid reply, its broken replies, a cancel, and a reply of every kind. */
function kindMatrix(): AnswerInput[] {
	const sampleReplies = KINDS.map((kind) => validReply(asked(requestOf(kind))));
	return KINDS.flatMap((kind) => {
		const request = requestOf(kind);
		return [
			{ name: `${kind}: to another interaction`, request, reply: validReply(asked(request)), interactionId: "i-2" },
			{ name: `${kind}: cancel and stop`, request, reply: { kind: "cancel", stopRun: true } },
			{ name: `${kind}: cancel with a message`, request, reply: { kind: "cancel", stopRun: false, message: "later" } },
			...invalidReplies(asked(request)).map((reply, index) => ({ name: `${kind}: invalid ${index}`, request, reply })),
			...sampleReplies.map((reply) => ({ name: `${kind}: a ${reply.kind} reply`, request, reply })),
		];
	});
}

function asked(request: InteractionRequest): Interaction {
	return { id: "i-1", createdAt: 1, title: "Asked", blocksRun: true, request };
}

function stringField(spec: Partial<StringField>): FormFieldSpec {
	return {
		kind: "string",
		key: "v",
		required: false,
		hidden: false,
		when: [],
		options: [],
		allowCustom: false,
		...spec,
	};
}

function textAnswer(name: string, field: FormFieldSpec, text: string): AnswerInput {
	const value: FormValue = { kind: "text", value: text };
	return { name, request: { kind: "form", fields: [field] }, reply: { kind: "form", values: { [field.key]: value } } };
}

/** The checks whose outcome JavaScript's own semantics decide: formats, patterns, lengths and blanks. */
function stringFieldCases(): AnswerInput[] {
	const formats = [
		...URI_INPUTS.map((text) => ["uri", text] as const),
		...EMAIL_INPUTS.map((text) => ["email", text] as const),
		...DATE_INPUTS.map((text) => ["date", text] as const),
		...DATE_TIME_INPUTS.map((text) => ["date-time", text] as const),
	];
	const bounds: Partial<StringField>[] = [
		{ minLength: 2 },
		{ maxLength: 1 },
		{ maxLength: 2 },
		{ minLength: 1, maxLength: 1 },
	];
	return [
		...formats.map(([format, text]) => textAnswer(`${format} ${JSON.stringify(text)}`, stringField({ format }), text)),
		...PATTERN_INPUTS.map(([pattern, text]) =>
			textAnswer(`pattern ${JSON.stringify(pattern)} on ${JSON.stringify(text)}`, stringField({ pattern }), text),
		),
		...LENGTH_INPUTS.flatMap((text) =>
			bounds.map((bound) =>
				textAnswer(`length ${JSON.stringify(bound)} of ${JSON.stringify(text)}`, stringField(bound), text),
			),
		),
		...BLANK_INPUTS.flatMap((text) => blankCases(text)),
	];
}

function blankCases(text: string): AnswerInput[] {
	const reply: InteractionReply = { kind: "tool_permission", optionId: "explain", message: text, grantIds: [] };
	const custom: InteractionReply = { kind: "questions", answers: [{ questionId: "q0", selected: [], custom: text }] };
	return [
		textAnswer(`required text ${JSON.stringify(text)}`, stringField({ required: true }), text),
		{ name: `required message ${JSON.stringify(text)}`, request: PERMISSION, reply },
		{ name: `free text ${JSON.stringify(text)}`, request: sampleRequest("questions"), reply: custom },
	];
}

function asJson(value: object): JsonValue {
	return JSON.parse(JSON.stringify(value));
}
