import { describe, expect, test } from "bun:test";
import {
	answerProblem,
	type FormFieldSpec,
	type FormValue,
	type Interaction,
	type InteractionReply,
	type InteractionRequest,
	type PermissionOption,
} from "../contract";

function interaction(request: InteractionRequest): Interaction {
	return { id: "i-1", createdAt: 1, title: "Asked", blocksRun: true, request };
}

function problem(request: InteractionRequest, reply: InteractionReply): string | undefined {
	return answerProblem(interaction(request), { interactionId: "i-1", reply });
}

const option = (id: string, effect: "allow" | "deny", message: PermissionOption["message"]): PermissionOption => ({
	id,
	label: id,
	effect,
	scope: "once",
	stopsRun: false,
	message,
});

const permission: InteractionRequest = {
	kind: "tool_permission",
	input: { command: "ls" },
	inputEditable: false,
	previews: [],
	options: [
		option("allow", "allow", "none"),
		option("deny", "deny", "optional"),
		option("explain", "deny", "required"),
	],
	grants: [],
	deliberate: false,
};

const grantRequest: InteractionRequest = {
	...permission,
	grants: [
		{ id: "net", kind: "network" },
		{ id: "tmp", kind: "write", target: "/tmp" },
	],
};

describe("answerProblem", () => {
	test("a cancel answers any kind", () => {
		expect(problem(permission, { kind: "cancel", stopRun: true })).toBeUndefined();
		expect(problem({ kind: "confirm" }, { kind: "cancel", stopRun: false, message: "later" })).toBeUndefined();
	});

	test("an answer naming another interaction is refused", () => {
		const reply: InteractionReply = { kind: "confirm", confirmed: true };
		expect(answerProblem(interaction({ kind: "confirm" }), { interactionId: "other", reply })).toMatch(/another/);
	});

	test("a reply of another kind is refused", () => {
		expect(problem({ kind: "confirm" }, { kind: "text", text: "x" })).toMatch(/cannot answer a confirm/);
	});

	describe("tool permission", () => {
		test("names an offered option", () => {
			expect(problem(permission, { kind: "tool_permission", optionId: "allow", grantIds: [] })).toBeUndefined();
			expect(problem(permission, { kind: "tool_permission", optionId: "maybe", grantIds: [] })).toMatch(/no option/);
		});

		test("follows the option's message policy", () => {
			const reply = (optionId: string, message?: string): InteractionReply => ({
				kind: "tool_permission",
				optionId,
				grantIds: [],
				...(message !== undefined && { message }),
			});
			expect(problem(permission, reply("allow", "why"))).toMatch(/takes no message/);
			expect(problem(permission, reply("deny"))).toBeUndefined();
			expect(problem(permission, reply("deny", "not now"))).toBeUndefined();
			expect(problem(permission, reply("explain", "  "))).toMatch(/needs a message/);
			expect(problem(permission, reply("explain", "use rg"))).toBeUndefined();
		});

		test("edits the input only when allowing an editable request", () => {
			const edited = (optionId: string): InteractionReply => ({
				kind: "tool_permission",
				optionId,
				grantIds: [],
				editedInput: { command: "ls -a" },
			});
			expect(problem(permission, edited("allow"))).toMatch(/only be edited/);
			const editable = { ...permission, inputEditable: true };
			expect(problem(editable, edited("allow"))).toBeUndefined();
			expect(problem(editable, edited("deny"))).toMatch(/only be edited/);
		});

		test("grants a non-empty subset when allowing and nothing when denying", () => {
			const grant = (optionId: string, grantIds: string[]): InteractionReply => ({
				kind: "tool_permission",
				optionId,
				grantIds,
			});
			expect(problem(grantRequest, grant("allow", ["tmp"]))).toBeUndefined();
			expect(problem(grantRequest, grant("allow", []))).toMatch(/at least one grant/);
			expect(problem(grantRequest, grant("allow", ["home"]))).toMatch(/not requested/);
			expect(problem(grantRequest, grant("allow", ["net", "net"]))).toMatch(/twice/);
			expect(problem(grantRequest, grant("deny", ["net"]))).toMatch(/grants nothing/);
			expect(problem(grantRequest, grant("deny", []))).toBeUndefined();
			expect(problem(permission, grant("allow", ["net"]))).toMatch(/not requested/);
		});
	});

	describe("questions", () => {
		const questions: InteractionRequest = {
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
					secret: false,
					required: false,
				},
			],
		};
		const answer = (...answers: { questionId: string; selected: string[]; custom?: string }[]): InteractionReply => ({
			kind: "questions",
			answers,
		});

		test("accepts option labels and allowed free text", () => {
			expect(problem(questions, answer({ questionId: "lib", selected: ["a"] }))).toBeUndefined();
			expect(
				problem(
					questions,
					answer({ questionId: "lib", selected: ["b"] }, { questionId: "tags", selected: ["x", "y"], custom: "z" }),
				),
			).toBeUndefined();
		});

		test("refuses what the question does not allow", () => {
			expect(problem(questions, answer({ questionId: "lib", selected: ["c"] }))).toMatch(/not one of the options/);
			expect(problem(questions, answer({ questionId: "lib", selected: ["a", "b"] }))).toMatch(/takes one answer/);
			expect(problem(questions, answer({ questionId: "lib", selected: [], custom: "c" }))).toMatch(/no free text/);
			expect(
				problem(
					questions,
					answer({ questionId: "lib", selected: ["a"] }, { questionId: "tags", selected: [], custom: " " }),
				),
			).toMatch(/empty free text/);
			expect(
				problem(questions, answer({ questionId: "lib", selected: ["a"] }, { questionId: "lib", selected: ["a"] })),
			).toMatch(/twice/);
			expect(problem(questions, answer({ questionId: "nope", selected: [] }))).toMatch(/no question/);
		});

		test("needs every required question answered", () => {
			expect(problem(questions, answer({ questionId: "tags", selected: ["x"] }))).toMatch(/lib needs an answer/);
			expect(problem(questions, answer({ questionId: "lib", selected: [] }))).toMatch(/lib needs an answer/);
		});
	});

	describe("form", () => {
		const base = { required: false, hidden: false, when: [] };
		const fields: FormFieldSpec[] = [
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
			{ kind: "string", key: "code", ...base, pattern: "^[A-Z]{3}$", minLength: 3, options: [], allowCustom: false },
			{
				kind: "string",
				key: "token",
				...base,
				required: true,
				hidden: true,
				defaultValue: "t0k3n",
				options: [],
				allowCustom: false,
			},
		];
		const form: InteractionRequest = { kind: "form", fields };
		const submit = (values: Extract<InteractionReply, { kind: "form" }>["values"]): InteractionReply => ({
			kind: "form",
			values,
		});
		const email = { kind: "text", value: "a@b.co" } as const;

		test("accepts a complete answer and leaves hidden fields to their defaults", () => {
			expect(problem(form, submit({ email }))).toBeUndefined();
			expect(
				problem(
					form,
					submit({
						email,
						notify: { kind: "boolean", value: true },
						channels: { kind: "choices", values: ["chat"] },
						retries: { kind: "number", value: 3 },
						code: { kind: "text", value: "ABC" },
					}),
				),
			).toBeUndefined();
		});

		test("activates a field only when its conditions hold", () => {
			const notify = { kind: "boolean", value: true } as const;
			expect(problem(form, submit({ email, notify }))).toMatch(/channels is required/);
			expect(problem(form, submit({ email, channels: { kind: "choices", values: ["mail"] } }))).toMatch(/not active/);
		});

		test("checks every value against its field", () => {
			expect(problem(form, submit({}))).toMatch(/email is required/);
			expect(problem(form, submit({ email: { kind: "text", value: "nope" } }))).toMatch(/not a valid email/);
			expect(problem(form, submit({ email, retries: { kind: "number", value: 2.5 } }))).toMatch(/expects an integer/);
			expect(problem(form, submit({ email, retries: { kind: "number", value: 9 } }))).toMatch(/above the maximum/);
			expect(problem(form, submit({ email, code: { kind: "text", value: "abc" } }))).toMatch(/pattern/);
			expect(problem(form, submit({ email, notify: { kind: "text", value: "yes" } }))).toMatch(/true or false/);
			const both: FormValue = { kind: "choices", values: ["mail", "chat"] };
			expect(problem(form, submit({ email, notify: { kind: "boolean", value: true }, channels: both }))).toMatch(
				/too many choices/,
			);
			expect(problem(form, submit({ email, extra: { kind: "text", value: "x" } }))).toMatch(/no field extra/);
		});

		test("a hidden required field needs a default to stand in for it", () => {
			const hidden: InteractionRequest = {
				kind: "form",
				fields: [{ kind: "boolean", key: "agree", required: true, hidden: true, when: [] }],
			};
			expect(problem(hidden, submit({}))).toMatch(/agree is required/);
			const defaulted: InteractionRequest = {
				kind: "form",
				fields: [{ kind: "boolean", key: "agree", required: true, hidden: true, when: [], defaultValue: true }],
			};
			expect(problem(defaulted, submit({}))).toBeUndefined();
		});

		test("a required answer is not empty", () => {
			const required: InteractionRequest = {
				kind: "form",
				fields: [
					{ kind: "string", key: "name", required: true, hidden: false, when: [], options: [], allowCustom: false },
					{
						kind: "multiselect",
						key: "tags",
						required: true,
						hidden: false,
						when: [],
						options: [{ value: "a", label: "A" }],
						allowCustom: false,
					},
				],
			};
			const tags: FormValue = { kind: "choices", values: ["a"] };
			expect(problem(required, submit({ name: { kind: "text", value: "" }, tags }))).toMatch(/name: needs an answer/);
			expect(
				problem(required, submit({ name: { kind: "text", value: "x" }, tags: { kind: "choices", values: [] } })),
			).toMatch(/tags: needs a choice/);
		});

		test("an external field must be acknowledged with true", () => {
			const external: InteractionRequest = {
				kind: "form",
				fields: [{ kind: "external", key: "url", url: "https://example.com" }],
			};
			expect(problem(external, submit({ url: { kind: "boolean", value: true } }))).toBeUndefined();
			expect(problem(external, submit({ url: { kind: "boolean", value: false } }))).toMatch(/acknowledged/);
			expect(problem(external, submit({}))).toMatch(/acknowledged/);
		});
	});

	describe("string fields", () => {
		const field = (spec: Partial<Extract<FormFieldSpec, { kind: "string" }>>): InteractionRequest => ({
			kind: "form",
			fields: [
				{
					kind: "string",
					key: "v",
					required: false,
					hidden: false,
					when: [],
					options: [],
					allowCustom: false,
					...spec,
				},
			],
		});
		const text = (value: string): InteractionReply => ({ kind: "form", values: { v: { kind: "text", value } } });

		test("a date is a real day of the calendar", () => {
			const date = field({ format: "date" });
			for (const valid of ["2026-01-31", "2024-02-29", "0001-01-01"])
				expect(problem(date, text(valid))).toBeUndefined();
			for (const invalid of ["2026-02-30", "2026-02-31", "2025-02-29", "2026-13-01", "2026-00-10", "2026-1-01"]) {
				expect(problem(date, text(invalid))).toMatch(/not a valid date/);
			}
		});

		test("a date-time is RFC 3339, with a calendar day, a clock time and an offset", () => {
			const dateTime = field({ format: "date-time" });
			for (const valid of ["2026-01-02T03:04:05Z", "2026-01-02t03:04:05.123z", "2026-01-02T23:59:60+05:30"]) {
				expect(problem(dateTime, text(valid))).toBeUndefined();
			}
			const invalid = [
				"2026-01-01T10:00:00",
				"2026-02-30T10:00:00Z",
				"2026-01-01T24:00:00Z",
				"2026-01-01T10:60:00Z",
				"2026-01-01T10:00:00+24:00",
				"2026-01-01 10:00:00Z",
				"T",
			];
			for (const value of invalid) expect(problem(dateTime, text(value))).toMatch(/not a valid date-time/);
		});

		test("an email has a dotted domain", () => {
			expect(problem(field({ format: "email" }), text("a@b.co"))).toBeUndefined();
			expect(problem(field({ format: "email" }), text("a@localhost"))).toMatch(/not a valid email/);
		});

		test("lengths pass under both code points and UTF-16 units", () => {
			expect(problem(field({ maxLength: 1 }), text("😀"))).toMatch(/too long/);
			expect(problem(field({ maxLength: 2 }), text("😀"))).toBeUndefined();
			expect(problem(field({ minLength: 2 }), text("😀"))).toMatch(/too short/);
		});

		test("a pattern holds with and without the u flag, and one that never compiles faults every answer", () => {
			const plainOnly = field({ pattern: "^[\\w\\-]+$" });
			expect(problem(plainOnly, text("a-b"))).toBeUndefined();
			expect(problem(plainOnly, text("a b"))).toMatch(/does not match/);
			expect(problem(field({ pattern: "^\\p{Lu}$" }), text("A"))).toMatch(/does not match/);
			expect(problem(field({ pattern: "(" }), text("x"))).toMatch(/does not compile/);
		});
	});

	test("plan approval keeps feedback and edits on the right side", () => {
		const plan: InteractionRequest = { kind: "plan_approval", plan: "1. Do it", editable: false };
		expect(problem(plan, { kind: "plan_approval", decision: "approve" })).toBeUndefined();
		expect(problem(plan, { kind: "plan_approval", decision: "reject", feedback: "smaller" })).toBeUndefined();
		expect(problem(plan, { kind: "plan_approval", decision: "approve", feedback: "x" })).toMatch(/rejection/);
		expect(problem(plan, { kind: "plan_approval", decision: "reject", plan: "x" })).toMatch(/approval/);
		expect(problem(plan, { kind: "plan_approval", decision: "approve", plan: "x" })).toMatch(/cannot be edited/);
		expect(
			problem({ ...plan, editable: true }, { kind: "plan_approval", decision: "approve", plan: "x" }),
		).toBeUndefined();
	});

	test("a choice must be offered and single-line text stays on one line", () => {
		const choice: InteractionRequest = { kind: "choice", options: [{ value: "a", label: "A" }] };
		expect(problem(choice, { kind: "choice", value: "a" })).toBeUndefined();
		expect(problem(choice, { kind: "choice", value: "b" })).toMatch(/not one of the options/);
		const text: InteractionRequest = { kind: "text", multiline: false };
		expect(problem(text, { kind: "text", text: "one\ntwo" })).toMatch(/single line/);
		expect(problem(text, { kind: "text", text: "one\rtwo" })).toMatch(/single line/);
		expect(problem({ ...text, multiline: true }, { kind: "text", text: "one\ntwo" })).toBeUndefined();
	});
});
