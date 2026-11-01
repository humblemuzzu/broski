/** The state a new session opens in: the modes asked for (never omitted, fact 5), the model and the thinking checked against the catalogue. */

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import {
	emptySnapshot,
	type ModelSummary,
	type NewSessionOptions,
	type Rejected,
	type SessionSnapshot,
} from "../../../contract";
import { DEFAULT_PERMISSION_MODE, isPermissionMode, PERMISSIONS_AXIS } from "../permission-modes";
import type { CatalogueAccess } from "../ports/catalogue";
import { isRejected, rejected } from "../rejections";

export interface NewSessionState {
	readonly snapshot: SessionSnapshot;
	/** The model the person named; the CLI is started on it. */
	readonly model: string | undefined;
}

function modeOf(options: NewSessionOptions): PermissionMode | Rejected {
	let mode = DEFAULT_PERMISSION_MODE;
	for (const setting of options.modes ?? []) {
		if (setting.axis !== PERMISSIONS_AXIS) return rejected("invalid_input", `Claude Code has no mode ${setting.axis}`);
		if (!isPermissionMode(setting.value))
			return rejected("invalid_input", `${setting.axis} has no value ${setting.value}`);
		mode = setting.value;
	}
	return mode;
}

async function offeredMode(
	catalogue: CatalogueAccess,
	cwd: string,
	mode: PermissionMode,
): Promise<Rejected | undefined> {
	const listed = await catalogue.modes(cwd);
	if (listed.status === "rejected") return undefined;
	const axis = listed.modes.find((candidate) => candidate.id === PERMISSIONS_AXIS);
	if (axis && !axis.options.some((option) => option.value === mode)) {
		return rejected("invalid_input", `${PERMISSIONS_AXIS} has no value ${mode} here`);
	}
	return undefined;
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
	const mode = modeOf(options);
	if (typeof mode !== "string") return mode;
	const unoffered = await offeredMode(catalogue, options.cwd, mode);
	if (unoffered) return unoffered;
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
