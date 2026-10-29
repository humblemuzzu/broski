import { z } from "zod";
import { FileChange } from "./content";
import { FormFieldSpec } from "./forms";
import { InteractionId, RunId, Timestamp, ToolCallId } from "./ids";
import { JsonValue } from "./json";
import { MAX_ID_CHARS, MAX_LIST_ITEMS, MAX_NAME_CHARS, MAX_PATH_CHARS, MAX_TEXT_CHARS } from "./limits";
import { Option } from "./option";

export const InteractionKind = z.enum([
	"tool_permission",
	"questions",
	"form",
	"plan_approval",
	"external_url",
	"choice",
	"confirm",
	"text",
]);
export type InteractionKind = z.infer<typeof InteractionKind>;

export const PermissionEffect = z.enum(["allow", "deny"]);
export type PermissionEffect = z.infer<typeof PermissionEffect>;

/** How long a decision holds: this call, the rest of the run, the session, or persisted as a rule. */
export const PermissionScope = z.enum(["once", "turn", "session", "always"]);
export type PermissionScope = z.infer<typeof PermissionScope>;

/** Whether a message to the model may, may not, or must accompany the decision. */
export const MessagePolicy = z.enum(["none", "optional", "required"]);
export type MessagePolicy = z.infer<typeof MessagePolicy>;

export const PermissionOption = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	label: z.string().min(1).max(MAX_NAME_CHARS),
	effect: PermissionEffect,
	scope: PermissionScope,
	/** Choosing this option ends the run. */
	stopsRun: z.boolean(),
	message: MessagePolicy,
	/** The rule an `always` option persists, as the backend words it. */
	rule: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type PermissionOption = z.infer<typeof PermissionOption>;

export const CommandPreview = z.strictObject({
	kind: z.literal("command"),
	command: z.string().max(MAX_TEXT_CHARS),
	cwd: z.string().max(MAX_PATH_CHARS).optional(),
});
export type CommandPreview = z.infer<typeof CommandPreview>;

export const FileChangesPreview = z.strictObject({
	kind: z.literal("file_changes"),
	changes: z.array(FileChange).max(MAX_LIST_ITEMS),
});
export type FileChangesPreview = z.infer<typeof FileChangesPreview>;

export const NetworkPreview = z.strictObject({
	kind: z.literal("network"),
	host: z.string().min(1).max(MAX_NAME_CHARS),
	protocol: z.string().max(MAX_NAME_CHARS).optional(),
});
export type NetworkPreview = z.infer<typeof NetworkPreview>;

export const PathsPreview = z.strictObject({
	kind: z.literal("paths"),
	paths: z.array(z.string().max(MAX_PATH_CHARS)).min(1).max(MAX_LIST_ITEMS),
});
export type PathsPreview = z.infer<typeof PathsPreview>;

export const PermissionPreview = z.discriminatedUnion("kind", [
	CommandPreview,
	FileChangesPreview,
	NetworkPreview,
	PathsPreview,
]);
export type PermissionPreview = z.infer<typeof PermissionPreview>;

export const GrantKind = z.enum(["network", "read", "write", "deny"]);
export type GrantKind = z.infer<typeof GrantKind>;

/** One item of a requested permission profile; an allow answer grants a non-empty subset of them. */
export const PermissionGrant = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	kind: GrantKind,
	/** The path or glob the grant covers; absent for network access. */
	target: z.string().max(MAX_PATH_CHARS).optional(),
});
export type PermissionGrant = z.infer<typeof PermissionGrant>;

export const ToolPermissionRequest = z.strictObject({
	kind: z.literal("tool_permission"),
	input: JsonValue.optional(),
	/** The answer may replace `input` when allowing. */
	inputEditable: z.boolean(),
	reason: z.string().max(MAX_TEXT_CHARS).optional(),
	previews: z.array(PermissionPreview).max(MAX_LIST_ITEMS),
	options: z.array(PermissionOption).min(1).max(MAX_LIST_ITEMS),
	grants: z.array(PermissionGrant).max(MAX_LIST_ITEMS),
	defaultOptionId: z.string().max(MAX_ID_CHARS).optional(),
	/** The UI must not offer a one-tap answer. */
	deliberate: z.boolean(),
});
export type ToolPermissionRequest = z.infer<typeof ToolPermissionRequest>;

export const QuestionOption = z.strictObject({
	label: z.string().min(1).max(MAX_NAME_CHARS),
	description: z.string().max(MAX_TEXT_CHARS).optional(),
	/** Markdown shown when the option is focused. */
	preview: z.string().max(MAX_TEXT_CHARS).optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const Question = z.strictObject({
	id: z.string().min(1).max(MAX_ID_CHARS),
	header: z.string().max(MAX_NAME_CHARS).optional(),
	text: z.string().min(1).max(MAX_TEXT_CHARS),
	options: z.array(QuestionOption).max(MAX_LIST_ITEMS),
	multiSelect: z.boolean(),
	allowCustom: z.boolean(),
	secret: z.boolean(),
	required: z.boolean(),
});
export type Question = z.infer<typeof Question>;

export const QuestionsRequest = z.strictObject({
	kind: z.literal("questions"),
	questions: z.array(Question).min(1).max(MAX_LIST_ITEMS),
});
export type QuestionsRequest = z.infer<typeof QuestionsRequest>;

export const FormRequest = z.strictObject({
	kind: z.literal("form"),
	fields: z.array(FormFieldSpec).min(1).max(MAX_LIST_ITEMS),
	/** The MCP server asking, for an elicitation. */
	server: z.string().max(MAX_NAME_CHARS).optional(),
});
export type FormRequest = z.infer<typeof FormRequest>;

export const PlanApprovalRequest = z.strictObject({
	kind: z.literal("plan_approval"),
	/** Markdown. */
	plan: z.string().max(MAX_TEXT_CHARS),
	editable: z.boolean(),
	path: z.string().max(MAX_PATH_CHARS).optional(),
});
export type PlanApprovalRequest = z.infer<typeof PlanApprovalRequest>;

export const ExternalUrlRequest = z.strictObject({
	kind: z.literal("external_url"),
	url: z.string().min(1).max(MAX_PATH_CHARS),
	server: z.string().max(MAX_NAME_CHARS).optional(),
});
export type ExternalUrlRequest = z.infer<typeof ExternalUrlRequest>;

export const ChoiceRequest = z.strictObject({
	kind: z.literal("choice"),
	options: z.array(Option).min(1).max(MAX_LIST_ITEMS),
});
export type ChoiceRequest = z.infer<typeof ChoiceRequest>;

export const ConfirmRequest = z.strictObject({ kind: z.literal("confirm") });
export type ConfirmRequest = z.infer<typeof ConfirmRequest>;

export const TextRequest = z.strictObject({
	kind: z.literal("text"),
	placeholder: z.string().max(MAX_NAME_CHARS).optional(),
	initialText: z.string().max(MAX_TEXT_CHARS).optional(),
	multiline: z.boolean(),
});
export type TextRequest = z.infer<typeof TextRequest>;

export const InteractionRequest = z.discriminatedUnion("kind", [
	ToolPermissionRequest,
	QuestionsRequest,
	FormRequest,
	PlanApprovalRequest,
	ExternalUrlRequest,
	ChoiceRequest,
	ConfirmRequest,
	TextRequest,
]);
export type InteractionRequest = z.infer<typeof InteractionRequest>;

export const InteractionOrigin = z.strictObject({
	toolCallId: ToolCallId.optional(),
	toolName: z.string().max(MAX_NAME_CHARS).optional(),
	parentToolCallId: ToolCallId.optional(),
});
export type InteractionOrigin = z.infer<typeof InteractionOrigin>;

export const Interaction = z.strictObject({
	id: InteractionId,
	/** Absent for an ask outside a run, such as a Pi extension command's dialog, which never blocks a run. */
	runId: RunId.optional(),
	createdAt: Timestamp,
	/** Set only when the backend itself will give up at this time. */
	expiresAt: Timestamp.optional(),
	title: z.string().max(MAX_NAME_CHARS),
	body: z.string().max(MAX_TEXT_CHARS).optional(),
	/** The run waits for this answer. */
	blocksRun: z.boolean(),
	origin: InteractionOrigin.optional(),
	request: InteractionRequest,
});
export type Interaction = z.infer<typeof Interaction>;
