import { fieldIsActive } from "../field-check";
import type { FormFieldSpec, FormValue } from "../forms";
import type { InteractionReply } from "../interaction-replies";
import type { FormRequest, Interaction, InteractionRequest, ToolPermissionRequest } from "../interactions";

/** A reply that answers `interaction` correctly, choosing the first allowed option everywhere. */
export function validReply(interaction: Interaction): InteractionReply {
	const request = interaction.request;
	switch (request.kind) {
		case "tool_permission":
			return permissionReply(request);
		case "questions":
			return {
				kind: "questions",
				answers: request.questions.map((question) => {
					const [option] = question.options;
					return option
						? { questionId: question.id, selected: [option.label] }
						: { questionId: question.id, selected: [], custom: "An answer" };
				}),
			};
		case "form":
			return { kind: "form", values: formValues(request) };
		case "plan_approval":
			return { kind: "plan_approval", decision: "approve" };
		case "external_url":
			return { kind: "external_url" };
		case "choice":
			return { kind: "choice", value: first(request.options, "choice options").value };
		case "confirm":
			return { kind: "confirm", confirmed: true };
		case "text":
			return { kind: "text", text: "An answer" };
	}
}

/** Replies `answerProblem` faults for `interaction`: one of the wrong kind, and broken ones of the right kind. */
export function invalidReplies(interaction: Interaction): InteractionReply[] {
	return [wrongKind(interaction.request), ...brokenReplies(interaction.request)];
}

function permissionReply(request: ToolPermissionRequest): InteractionReply {
	const option = request.options.find((candidate) => candidate.effect === "allow") ?? first(request.options, "options");
	const [grant] = request.grants;
	return {
		kind: "tool_permission",
		optionId: option.id,
		...(option.message === "required" && { message: "Go ahead." }),
		grantIds: option.effect === "allow" && grant ? [grant.id] : [],
	};
}

function formValues(request: FormRequest): Record<string, FormValue> {
	const values: Record<string, FormValue> = {};
	for (const field of request.fields) {
		const value = fieldValue(field);
		if (value !== undefined && fieldIsActive(field, values)) values[field.key] = value;
	}
	return values;
}

/** Undefined when no value can be made up for the field and it is not required. */
function fieldValue(field: FormFieldSpec): FormValue | undefined {
	switch (field.kind) {
		case "string":
			return stringValue(field);
		case "number":
		case "integer": {
			const value = field.defaultValue ?? field.minimum ?? Math.min(0, field.maximum ?? 0);
			return { kind: "number", value };
		}
		case "boolean":
			return { kind: "boolean", value: field.defaultValue ?? true };
		case "multiselect": {
			const count = Math.max(field.minItems ?? 1, 1);
			const values = field.defaultValue ?? field.options.slice(0, count).map((option) => option.value);
			return { kind: "choices", values };
		}
		case "external":
			return { kind: "boolean", value: true };
	}
}

const FORMAT_EXAMPLES = {
	email: "someone@example.com",
	uri: "https://example.com",
	date: "2026-01-02",
	"date-time": "2026-01-02T03:04:05Z",
};

function stringValue(field: Extract<FormFieldSpec, { kind: "string" }>): FormValue | undefined {
	if (field.defaultValue !== undefined) return { kind: "text", value: field.defaultValue };
	const [option] = field.options;
	if (option) return { kind: "text", value: option.value };
	if (field.pattern !== undefined) {
		if (field.required) throw new Error(`cannot make up an answer matching the pattern of ${field.key}`);
		return undefined;
	}
	const text = field.format ? FORMAT_EXAMPLES[field.format] : "x".repeat(Math.max(field.minLength ?? 1, 1));
	return { kind: "text", value: text };
}

function wrongKind(request: InteractionRequest): InteractionReply {
	return request.kind === "text" ? { kind: "confirm", confirmed: true } : { kind: "text", text: "wrong kind" };
}

function brokenReplies(request: InteractionRequest): InteractionReply[] {
	switch (request.kind) {
		case "tool_permission":
			return [{ kind: "tool_permission", optionId: "no-such-option", grantIds: [] }];
		case "questions":
			return [{ kind: "questions", answers: [{ questionId: "no-such-question", selected: [] }] }];
		case "form":
			return [{ kind: "form", values: { "no-such-field": { kind: "text", value: "x" } } }];
		case "choice":
			return [{ kind: "choice", value: "no-such-option" }];
		case "plan_approval":
			return [{ kind: "plan_approval", decision: "approve", feedback: "feedback goes with a rejection" }];
		case "external_url":
		case "confirm":
		case "text":
			return [];
	}
}

function first<T>(values: readonly T[], what: string): T {
	const [value] = values;
	if (value === undefined) throw new Error(`no ${what}`);
	return value;
}
