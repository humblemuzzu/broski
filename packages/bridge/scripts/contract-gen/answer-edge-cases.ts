import type {
	FormFieldSpec,
	FormValue,
	InteractionReply,
	InteractionRequest,
	QuestionAnswer,
} from "../../src/contract";
import { type AnswerInput, PERMISSION } from "./answer-input";

/** Every branch of `answerProblem` and `fieldProblem` past the kind check, one input per branch or edge. */
export function answerEdgeCases(): AnswerInput[] {
	return [
		...permissionCases(),
		...questionCases(),
		...formCases(),
		...valueCases(),
		...otherKindCases(),
		...planModeCases(),
	];
}

const permit = (optionId: string, extra: Partial<Extract<InteractionReply, { kind: "tool_permission" }>> = {}) =>
	({ kind: "tool_permission", optionId, grantIds: [], ...extra }) satisfies InteractionReply;

function permissionCases(): AnswerInput[] {
	const grants: InteractionRequest = {
		...PERMISSION,
		inputEditable: false,
		grants: [
			{ id: "net", kind: "network" },
			{ id: "tmp", kind: "write", target: "/tmp" },
		],
	};
	const replies: [string, InteractionRequest, InteractionReply][] = [
		["unknown option", PERMISSION, permit("maybe")],
		["message on a none option", PERMISSION, permit("allow", { message: "why" })],
		["empty message on a none option", PERMISSION, permit("allow", { message: "" })],
		["no message on an optional option", PERMISSION, permit("deny")],
		["message on an optional option", PERMISSION, permit("deny", { message: "no" })],
		["no message on a required option", PERMISSION, permit("explain")],
		["message on a required option", PERMISSION, permit("explain", { message: "use rg" })],
		["edited input allowing an editable request", PERMISSION, permit("allow", { editedInput: { command: "ls -a" } })],
		["edited input denying", PERMISSION, permit("deny", { editedInput: null })],
		["edited input on a fixed request", grants, permit("allow", { grantIds: ["net"], editedInput: "x" })],
		["one grant", grants, permit("allow", { grantIds: ["tmp"] })],
		["every grant", grants, permit("allow", { grantIds: ["net", "tmp"] })],
		["no grant allowing", grants, permit("allow")],
		["an unrequested grant", grants, permit("allow", { grantIds: ["home"] })],
		["a grant twice", grants, permit("allow", { grantIds: ["net", "net"] })],
		["a grant denying", grants, permit("deny", { grantIds: ["net"] })],
		["a grant on a request without grants", PERMISSION, permit("allow", { grantIds: ["net"] })],
	];
	return replies.map(([name, request, reply]) => ({ name: `permission: ${name}`, request, reply }));
}

function questionCases(): AnswerInput[] {
	const request: InteractionRequest = {
		kind: "questions",
		questions: [
			{
				id: "lib",
				text: "Which library?",
				options: [{ label: "a" }, { label: "b" }],
				multiSelect: false,
				allowCustom: false,
				secret: false,
				required: true,
			},
			{
				id: "tags",
				text: "Which tags?",
				options: [{ label: "x" }, { label: "y" }],
				multiSelect: true,
				allowCustom: true,
				secret: true,
				required: false,
			},
		],
	};
	const answer = (...answers: QuestionAnswer[]): InteractionReply => ({ kind: "questions", answers });
	const lib = { questionId: "lib", selected: ["a"] };
	const replies: [string, InteractionReply][] = [
		["one option", answer(lib)],
		["every question", answer(lib, { questionId: "tags", selected: ["x", "y"], custom: "z" })],
		["no answers", answer()],
		["an unknown option", answer({ questionId: "lib", selected: ["c"] })],
		["two options on a single choice", answer({ questionId: "lib", selected: ["a", "b"] })],
		["an option and free text on a single choice", answer({ questionId: "lib", selected: ["a"], custom: "c" })],
		["free text where none is allowed", answer({ questionId: "lib", selected: [], custom: "c" })],
		["an option twice", answer(lib, { questionId: "tags", selected: ["x", "x"] })],
		["an empty required answer", answer({ questionId: "lib", selected: [] })],
		["an empty optional answer", answer(lib, { questionId: "tags", selected: [] })],
		["a question twice", answer(lib, lib)],
		["an unknown question", answer(lib, { questionId: "nope", selected: [] })],
		["only the optional question", answer({ questionId: "tags", selected: ["x"] })],
	];
	return replies.map(([name, reply]) => ({ name: `questions: ${name}`, request, reply }));
}

const base = { required: false, hidden: false, when: [] };

/** A form with every kind of rule an answer can break: formats, conditions, hidden defaults, an external step. */
const FORM_FIELDS: FormFieldSpec[] = [
	{ kind: "string", key: "email", ...base, required: true, format: "email", options: [], allowCustom: false },
	{ kind: "boolean", key: "notify", ...base },
	{
		kind: "multiselect",
		key: "channels",
		...base,
		required: true,
		when: [{ key: "notify", op: "eq", value: { kind: "boolean", value: true } }],
		options: [
			{ value: "mail", label: "Mail" },
			{ value: "chat", label: "Chat" },
		],
		minItems: 1,
		maxItems: 1,
		allowCustom: false,
	},
	{ kind: "integer", key: "retries", ...base, minimum: 0, maximum: 5 },
	{
		kind: "string",
		key: "token",
		...base,
		required: true,
		hidden: true,
		defaultValue: "t",
		options: [],
		allowCustom: false,
	},
	{ kind: "external", key: "docs", url: "https://example.com" },
];

function formCases(): AnswerInput[] {
	const request: InteractionRequest = { kind: "form", fields: FORM_FIELDS };
	const email: FormValue = { kind: "text", value: "a@b.co" };
	const docs: FormValue = { kind: "boolean", value: true };
	const on: FormValue = { kind: "boolean", value: true };
	const values: [string, Record<string, FormValue>][] = [
		["the required fields", { email, docs }],
		["every field", { email, docs, notify: on, channels: { kind: "choices", values: ["chat"] }, token: email }],
		["nothing", {}],
		["an active required field missing", { email, docs, notify: on }],
		["an inactive field answered", { email, docs, channels: { kind: "choices", values: ["mail"] } }],
		["an unacknowledged external field", { email, docs: { kind: "boolean", value: false } }],
		["an external field missing", { email }],
		["unknown fields in property order", { b: email, 2: email, email, 1: email, docs }],
	];
	return [
		...values.map(
			([name, answer]) =>
				({ name: `form: ${name}`, request, reply: { kind: "form", values: answer } }) satisfies AnswerInput,
		),
		...hiddenFieldCases(),
		...inheritedKeyCases(),
		{
			name: "form: an answer keyed __proto__, which no field can be and the wire refuses",
			request,
			reply: { kind: "form", values: { email, docs, ["__proto__"]: email } },
			beyondTheWire: true,
		},
	];
}

/** Field keys every JavaScript object inherits are keys like any other. */
function inheritedKeyCases(): AnswerInput[] {
	const field = (key: string, required: boolean): FormFieldSpec => ({
		kind: "string",
		key,
		required,
		hidden: false,
		when: [],
		options: [],
		allowCustom: false,
	});
	const text: FormValue = { kind: "text", value: "x" };
	return ["constructor", "toString", "hasOwnProperty"].flatMap((key) =>
		[false, true].flatMap((required) =>
			[{}, { [key]: text }].map(
				(values): AnswerInput => ({
					name: `form: inherited key ${key}, required ${required}, ${Object.keys(values).length} answers`,
					request: { kind: "form", fields: [field(key, required)] },
					reply: { kind: "form", values },
				}),
			),
		),
	);
}

/** A hidden required field counts as answered only when its default stands in for it. */
function hiddenFieldCases(): AnswerInput[] {
	const hidden: [string, FormFieldSpec][] = [
		["boolean", { kind: "boolean", key: "h", ...base, required: true, hidden: true }],
		["defaulted boolean", { kind: "boolean", key: "h", ...base, required: true, hidden: true, defaultValue: false }],
		["defaulted number", { kind: "number", key: "h", ...base, required: true, hidden: true, defaultValue: 0 }],
		[
			"multiselect",
			{
				kind: "multiselect",
				key: "h",
				...base,
				required: true,
				hidden: true,
				options: [{ value: "a", label: "A" }],
				allowCustom: false,
			},
		],
		[
			"defaulted multiselect",
			{
				kind: "multiselect",
				key: "h",
				...base,
				required: true,
				hidden: true,
				options: [{ value: "a", label: "A" }],
				allowCustom: false,
				defaultValue: [],
			},
		],
	];
	return hidden.map(
		([name, field]) =>
			({
				name: `form: hidden required ${name}`,
				request: { kind: "form", fields: [field] },
				reply: { kind: "form", values: {} },
			}) satisfies AnswerInput,
	);
}

function valueCases(): AnswerInput[] {
	const options = [
		{ value: "a", label: "A" },
		{ value: "b", label: "B" },
	];
	const fields: [string, FormFieldSpec][] = [
		["number", { kind: "number", key: "v", ...base, minimum: -1.5, maximum: 2.5 }],
		["integer", { kind: "integer", key: "v", ...base, minimum: -2, maximum: 3 }],
		["boolean", { kind: "boolean", key: "v", ...base }],
		["closed string", { kind: "string", key: "v", ...base, required: true, options, allowCustom: false }],
		["open string", { kind: "string", key: "v", ...base, options, allowCustom: true }],
		[
			"multiselect",
			{ kind: "multiselect", key: "v", ...base, required: true, options, minItems: 1, maxItems: 2, allowCustom: false },
		],
		["open multiselect", { kind: "multiselect", key: "v", ...base, options, allowCustom: true }],
		["external", { kind: "external", key: "v", url: "https://example.com" }],
	];
	const values: FormValue[] = [
		{ kind: "number", value: 2 },
		{ kind: "number", value: 2.5 },
		{ kind: "number", value: -1.5 },
		{ kind: "number", value: -2 },
		{ kind: "number", value: 3.5 },
		{ kind: "number", value: -0 },
		{ kind: "number", value: 1e21 },
		{ kind: "text", value: "a" },
		{ kind: "text", value: "c" },
		{ kind: "text", value: "" },
		{ kind: "boolean", value: true },
		{ kind: "boolean", value: false },
		{ kind: "choices", values: [] },
		{ kind: "choices", values: ["a"] },
		{ kind: "choices", values: ["a", "b"] },
		{ kind: "choices", values: ["a", "a"] },
		{ kind: "choices", values: ["a", "b", "c"] },
		{ kind: "choices", values: ["c"] },
	];
	return fields.flatMap(([name, field]) =>
		values.map((value) => ({
			name: `${name} field given ${JSON.stringify(value)}`,
			request: { kind: "form", fields: [field] } satisfies InteractionRequest,
			reply: { kind: "form", values: { v: value } } satisfies InteractionReply,
		})),
	);
}

/** An approval may name the mode the session goes on in, only one the plan offers. */
function planModeCases(): AnswerInput[] {
	const offering: InteractionRequest = {
		kind: "plan_approval",
		plan: "1. Do it",
		editable: true,
		modeOptions: {
			axis: "permissions",
			options: [
				{ value: "default", label: "Ask" },
				{ value: "acceptEdits", label: "Accept edits" },
			],
			defaultValue: "default",
		},
	};
	const silent: InteractionRequest = { kind: "plan_approval", plan: "1. Do it", editable: true };
	const replies: InteractionReply[] = [
		{ kind: "plan_approval", decision: "approve", modeAfter: "acceptEdits" },
		{ kind: "plan_approval", decision: "approve", plan: "edited", modeAfter: "default" },
		{ kind: "plan_approval", decision: "approve", modeAfter: "plan" },
		{ kind: "plan_approval", decision: "approve", modeAfter: "" },
		{ kind: "plan_approval", decision: "approve", modeAfter: "AcceptEdits" },
		{ kind: "plan_approval", decision: "reject", feedback: "smaller", modeAfter: "acceptEdits" },
		{ kind: "plan_approval", decision: "approve" },
	];
	return [offering, silent].flatMap((request) =>
		replies.map((reply) => ({
			name: `plan (modes ${request.kind === "plan_approval" && request.modeOptions !== undefined}): ${JSON.stringify(reply)}`,
			request,
			reply,
		})),
	);
}

function otherKindCases(): AnswerInput[] {
	const plan = (editable: boolean): InteractionRequest => ({ kind: "plan_approval", plan: "1. Do it", editable });
	const decisions: InteractionReply[] = [
		{ kind: "plan_approval", decision: "approve" },
		{ kind: "plan_approval", decision: "approve", plan: "edited" },
		{ kind: "plan_approval", decision: "approve", feedback: "x" },
		{ kind: "plan_approval", decision: "reject" },
		{ kind: "plan_approval", decision: "reject", feedback: "smaller" },
		{ kind: "plan_approval", decision: "reject", plan: "x" },
	];
	const single: InteractionRequest = { kind: "text", multiline: false };
	const texts = ["one", "one\ntwo", "one\rtwo", "one\u2028two", "one\u0085two", ""];
	const choice: InteractionRequest = {
		kind: "choice",
		options: [
			{ value: "a", label: "A" },
			{ value: "", label: "None" },
		],
	};
	return [
		...[true, false].flatMap((editable) =>
			decisions.map((reply) => ({
				name: `plan (editable ${editable}): ${JSON.stringify(reply)}`,
				request: plan(editable),
				reply,
			})),
		),
		...[false, true].flatMap((multiline) =>
			texts.map((text) => ({
				name: `text (multiline ${multiline}): ${JSON.stringify(text)}`,
				request: { ...single, multiline },
				reply: { kind: "text", text } satisfies InteractionReply,
			})),
		),
		...["a", "", "b"].map((value) => ({
			name: `choice ${JSON.stringify(value)}`,
			request: choice,
			reply: { kind: "choice", value } satisfies InteractionReply,
		})),
		{ name: "confirm false", request: { kind: "confirm" }, reply: { kind: "confirm", confirmed: false } },
	];
}
