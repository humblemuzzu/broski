import { answerFor, fieldIsActive, fieldProblem } from "./field-check";
import type { FormFieldSpec } from "./forms";
import type {
	FormReply,
	InteractionAnswer,
	InteractionReply,
	PlanApprovalReply,
	QuestionsReply,
	ToolPermissionReply,
} from "./interaction-replies";
import type {
	FormRequest,
	Interaction,
	InteractionRequest,
	PlanApprovalRequest,
	QuestionsRequest,
	ToolPermissionRequest,
} from "./interactions";

/**
 * Why `answer` is not a valid answer to `interaction`, or undefined when it is. Adapters reject an
 * answer this function faults with `invalid_input` and never send it to the backend.
 */
export function answerProblem(interaction: Interaction, answer: InteractionAnswer): string | undefined {
	if (answer.interactionId !== interaction.id) return "the answer names another interaction";
	const request = interaction.request;
	const reply = answer.reply;
	switch (reply.kind) {
		case "cancel":
			return undefined;
		case "tool_permission":
			return request.kind === reply.kind ? permissionProblem(request, reply) : mismatch(request, reply);
		case "questions":
			return request.kind === reply.kind ? questionsProblem(request, reply) : mismatch(request, reply);
		case "form":
			return request.kind === reply.kind ? formProblem(request, reply) : mismatch(request, reply);
		case "plan_approval":
			return request.kind === reply.kind ? planProblem(request, reply) : mismatch(request, reply);
		case "choice":
			if (request.kind !== reply.kind) return mismatch(request, reply);
			return request.options.some((option) => option.value === reply.value) ? undefined : "not one of the options";
		case "text":
			if (request.kind !== reply.kind) return mismatch(request, reply);
			return !request.multiline && /[\r\n]/.test(reply.text) ? "this text is a single line" : undefined;
		case "confirm":
			return request.kind === reply.kind ? undefined : mismatch(request, reply);
	}
}

function mismatch(request: InteractionRequest, reply: InteractionReply): string {
	return `a ${reply.kind} reply cannot answer a ${request.kind} interaction`;
}

function planProblem(request: PlanApprovalRequest, reply: PlanApprovalReply): string | undefined {
	if (reply.decision === "approve" && reply.feedback !== undefined) return "feedback goes with a rejection";
	if (reply.decision === "reject" && reply.plan !== undefined) return "an edited plan goes with an approval";
	if (reply.plan !== undefined && !request.editable) return "this plan cannot be edited";
	if (reply.modeAfter === undefined) return undefined;
	if (reply.decision === "reject") return "a mode goes with an approval";
	if (request.modeOptions === undefined) return "this plan offers no mode to continue in";
	const { modeAfter } = reply;
	return request.modeOptions.options.some((option) => option.value === modeAfter)
		? undefined
		: "not one of the modes offered";
}

function permissionProblem(request: ToolPermissionRequest, reply: ToolPermissionReply): string | undefined {
	const option = request.options.find((candidate) => candidate.id === reply.optionId);
	if (!option) return `no option ${reply.optionId}`;
	const hasMessage = reply.message !== undefined && reply.message.trim() !== "";
	if (option.message === "none" && reply.message !== undefined) return "this option takes no message";
	if (option.message === "required" && !hasMessage) return "this option needs a message";
	if (reply.editedInput !== undefined && !(request.inputEditable && option.effect === "allow")) {
		return "the input can only be edited when allowing an editable request";
	}
	if (new Set(reply.grantIds).size !== reply.grantIds.length) return "a grant is listed twice";
	const known = new Set(request.grants.map((grant) => grant.id));
	if (reply.grantIds.some((id) => !known.has(id))) return "a grant that was not requested";
	if (option.effect === "deny" && reply.grantIds.length > 0) return "a denial grants nothing";
	if (option.effect === "allow" && request.grants.length > 0 && reply.grantIds.length === 0) {
		return "allowing needs at least one grant";
	}
	return undefined;
}

function questionsProblem(request: QuestionsRequest, reply: QuestionsReply): string | undefined {
	const answered = new Set<string>();
	for (const answer of reply.answers) {
		const question = request.questions.find((candidate) => candidate.id === answer.questionId);
		if (!question) return `no question ${answer.questionId}`;
		if (answered.has(question.id)) return `question ${question.id} is answered twice`;
		answered.add(question.id);
		const labels = new Set(question.options.map((option) => option.label));
		if (answer.selected.some((label) => !labels.has(label))) return `question ${question.id}: not one of the options`;
		if (new Set(answer.selected).size !== answer.selected.length) return `question ${question.id}: an option twice`;
		if (answer.custom !== undefined && !question.allowCustom) return `question ${question.id} takes no free text`;
		if (answer.custom !== undefined && answer.custom.trim() === "") return `question ${question.id}: empty free text`;
		const picks = answer.selected.length + (answer.custom === undefined ? 0 : 1);
		if (!question.multiSelect && picks > 1) return `question ${question.id} takes one answer`;
		if (question.required && picks === 0) return `question ${question.id} needs an answer`;
	}
	const missing = request.questions.find((question) => question.required && !answered.has(question.id));
	return missing ? `question ${missing.id} needs an answer` : undefined;
}

function formProblem(request: FormRequest, reply: FormReply): string | undefined {
	const keys = new Set(request.fields.map((field) => field.key));
	const unknown = Object.keys(reply.values).find((key) => !keys.has(key));
	if (unknown !== undefined) return `no field ${unknown}`;
	for (const field of request.fields) {
		const value = answerFor(reply.values, field.key);
		if (!fieldIsActive(field, reply.values)) {
			if (value !== undefined) return `field ${field.key} is not active`;
			continue;
		}
		if (value === undefined) {
			if (field.kind === "external") return `field ${field.key} must be acknowledged`;
			if (field.required && !(field.hidden && hasDefault(field))) return `field ${field.key} is required`;
			continue;
		}
		const problem = fieldProblem(field, value);
		if (problem !== undefined) return `field ${field.key}: ${problem}`;
	}
	return undefined;
}

/** A hidden field's default answers for it (see `StringField.hidden`). */
function hasDefault(field: FormFieldSpec): boolean {
	return field.kind !== "external" && field.defaultValue !== undefined;
}
