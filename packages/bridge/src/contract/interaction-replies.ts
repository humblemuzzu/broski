import { z } from "zod";
import { FieldKey, FormValue } from "./forms";
import { InteractionId } from "./ids";
import { fewKeys, JsonValue } from "./json";
import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_TEXT_CHARS } from "./limits";

export const ToolPermissionReply = z.strictObject({
	kind: z.literal("tool_permission"),
	optionId: z.string().min(1).max(MAX_ID_CHARS),
	message: z.string().max(MAX_TEXT_CHARS).optional(),
	editedInput: JsonValue.optional(),
	grantIds: z.array(z.string().max(MAX_ID_CHARS)).max(MAX_LIST_ITEMS),
});
export type ToolPermissionReply = z.infer<typeof ToolPermissionReply>;

/** `selected` holds option labels; `custom` is free text where the question allows it. */
export const QuestionAnswer = z.strictObject({
	questionId: z.string().min(1).max(MAX_ID_CHARS),
	selected: z.array(z.string().max(MAX_NAME_CHARS)).max(MAX_LIST_ITEMS),
	custom: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

export const QuestionsReply = z.strictObject({
	kind: z.literal("questions"),
	answers: z.array(QuestionAnswer).max(MAX_LIST_ITEMS),
});
export type QuestionsReply = z.infer<typeof QuestionsReply>;

/** A parsed reply keeps an own `__proto__` key that zod's record parse would drop; refused, as `FieldKey` says. */
const withoutProtoKey = z.custom<object>(
	(values) => typeof values !== "object" || values === null || !Object.hasOwn(values, "__proto__"),
	"a field key cannot be __proto__",
);

export const FormReply = z.strictObject({
	kind: z.literal("form"),
	values: withoutProtoKey.pipe(z.record(FieldKey, FormValue).refine(fewKeys, "too many values")),
});
export type FormReply = z.infer<typeof FormReply>;

export const PlanDecision = z.enum(["approve", "reject"]);
export type PlanDecision = z.infer<typeof PlanDecision>;

export const PlanApprovalReply = z.strictObject({
	kind: z.literal("plan_approval"),
	decision: PlanDecision,
	/** The edited plan, approving an editable plan. */
	plan: z.string().max(MAX_TEXT_CHARS).optional(),
	/** Why, rejecting. */
	feedback: z.string().max(MAX_TEXT_CHARS).optional(),
	/** One of the request's `modeOptions`, approving (since 1.4). */
	modeAfter: z.string().max(MAX_NAME_CHARS).optional(),
});
export type PlanApprovalReply = z.infer<typeof PlanApprovalReply>;

/** The user opened the link and consents to continue. */
export const ExternalUrlReply = z.strictObject({ kind: z.literal("external_url") });
export type ExternalUrlReply = z.infer<typeof ExternalUrlReply>;

export const ChoiceReply = z.strictObject({ kind: z.literal("choice"), value: z.string().max(MAX_NAME_CHARS) });
export type ChoiceReply = z.infer<typeof ChoiceReply>;

export const ConfirmReply = z.strictObject({ kind: z.literal("confirm"), confirmed: z.boolean() });
export type ConfirmReply = z.infer<typeof ConfirmReply>;

export const TextReply = z.strictObject({ kind: z.literal("text"), text: z.string().max(MAX_TEXT_CHARS) });
export type TextReply = z.infer<typeof TextReply>;

/**
 * The human gives no answer: they dismissed it, or the bridge's timeout policy answered for them.
 * Valid for every kind. `stopRun` says whether the run ends or goes on without the answer.
 */
export const CancelReply = z.strictObject({
	kind: z.literal("cancel"),
	stopRun: z.boolean(),
	message: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type CancelReply = z.infer<typeof CancelReply>;

export const InteractionReply = z.discriminatedUnion("kind", [
	ToolPermissionReply,
	QuestionsReply,
	FormReply,
	PlanApprovalReply,
	ExternalUrlReply,
	ChoiceReply,
	ConfirmReply,
	TextReply,
	CancelReply,
]);
export type InteractionReply = z.infer<typeof InteractionReply>;

export const InteractionAnswer = z.strictObject({ interactionId: InteractionId, reply: InteractionReply });
export type InteractionAnswer = z.infer<typeof InteractionAnswer>;

/**
 * `answered`: this bridge delivered an answer. `withdrawn`: the backend ended the ask without one
 * (run interrupted, another client answered, the tool call ended). `expired`: nothing can answer it
 * any more (the backend process or the bridge restarted).
 */
export const ResolutionReason = z.enum(["answered", "withdrawn", "expired"]);
export type ResolutionReason = z.infer<typeof ResolutionReason>;
