/**
 * The state a new session opens in: the modes asked for (never omitted, D5), the model and the thinking checked against
 * the catalogue.
 */

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { isRejected, rejected } from "../../../adapter-kit/rejections";
import {
	emptySnapshot,
	type ModelSummary,
	type NewSessionOptions,
	type Rejected,
	type SessionSnapshot,
} from "../../../contract";
import { DEFAULT_PERMISSION_MODE, isPermissionMode, PERMISSIONS_AXIS } from "../permission-modes";
import type { CatalogueAccess } from "../ports/catalogue";

export interface NewSessionState {
	readonly snapshot: SessionSnapshot;
	/** The model the person named; the CLI is started on it. */
	readonly model: string | undefined;
}

function requestedMode(options: NewSessionOptions): PermissionMode | undefined | Rejected {
	let mode: PermissionMode | undefined;
	for (const setting of options.modes ?? []) {
		if (setting.axis !== PERMISSIONS_AXIS) return rejected("invalid_input", `Claude Code has no mode ${setting.axis}`);
		if (!isPermissionMode(setting.value))
			return rejected("invalid_input", `${setting.axis} has no value ${setting.value}`);
		mode = setting.value;
	}
	return mode;
}

async function resolveMode(
	catalogue: CatalogueAccess,
	cwd: string,
	requested: PermissionMode | undefined,
): Promise<PermissionMode | Rejected> {
	const listed = await catalogue.modes(cwd);
	const axis = listed.status === "accepted" ? listed.modes.find((c) => c.id === PERMISSIONS_AXIS) : undefined;
	if (requested !== undefined) {
		if (axis && !axis.options.some((option) => option.value === requested)) {
			return rejected("invalid_input", `${PERMISSIONS_AXIS} has no value ${requested} here`);
		}
		return requested;
	}
	const configured = axis?.defaultValue;
	return configured !== undefined && isPermissionMode(configured) ? configured : DEFAULT_PERMISSION_MODE;
}

async function chosenModel(
	catalogue: CatalogueAccess,
	options: NewSessionOptions,
): Promise<ModelSummary | Rejected | undefined> {
	if (options.modelId !== undefined) {
		const named = await catalogue.model(options.cwd, options.modelId);
		return named ?? rejected("not_found", `Claude Code offers no model ${options.modelId}`);
	}
	const listed = await catalogue.models(options.cwd);
	if (listed.status === "rejected") return options.thinking === undefined ? undefined : listed;
	return listed.models.find((model) => model.isDefault);
}

export async function newSessionState(
	catalogue: CatalogueAccess,
	options: NewSessionOptions,
): Promise<NewSessionState | Rejected> {
	const requested = requestedMode(options);
	if (requested !== undefined && typeof requested !== "string") return requested;
	const mode = await resolveMode(catalogue, options.cwd, requested);
	if (typeof mode !== "string") return mode;
	const model = await chosenModel(catalogue, options);
	if (model !== undefined && isRejected(model)) return model;
	if (options.thinking !== undefined && !model?.thinking.options.some((option) => option.value === options.thinking)) {
		return rejected("invalid_input", `the model does not offer thinking ${options.thinking}`);
	}
	return {
		model: options.modelId,
		snapshot: {
			...emptySnapshot(),
			modes: [{ axis: PERMISSIONS_AXIS, value: mode }],
			...(model !== undefined && { modelId: model.id }),
			...(options.thinking !== undefined && { thinking: options.thinking }),
		},
	};
}
