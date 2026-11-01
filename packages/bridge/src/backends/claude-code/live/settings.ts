/** `setModel` (D11), `setThinking` = `applyFlagSettings({effortLevel})`, `setMode` (D12), reconciled with what the CLI reports. */

import type { EffortLevel, Query } from "@anthropic-ai/claude-agent-sdk";
import type {
	ActionResult,
	ModeAxis,
	ModeAxisId,
	ModelId,
	ModelSummary,
	PlanModeOptions,
	Rejected,
	ThinkingSpec,
} from "../../../contract";
import { DEFAULT_PERMISSION_MODE, isPermissionMode, PERMISSION_MODES, PERMISSIONS_AXIS } from "../permission-modes";
import type { CatalogueAccess } from "../ports/catalogue";
import type { SessionEmitter } from "../ports/live";
import { ACCEPTED, CLOSED, isRejected, rejected } from "../rejections";
import { errorText } from "./error-text";

export interface SettingsDeps {
	readonly live: SessionEmitter;
	readonly catalogue: CatalogueAccess;
	readonly cwd: string;
	readonly query: () => Query | undefined;
	readonly ensureProcess: () => Promise<Rejected | undefined>;
	readonly locked: <T>(work: () => Promise<T>) => Promise<T>;
	readonly closed: () => boolean;
}

function isEffortLevel(value: string): value is EffortLevel {
	switch (value) {
		case "low":
		case "medium":
		case "high":
		case "xhigh":
		case "max":
			return true;
		default:
			return false;
	}
}

export class SessionSettings {
	/** The model the CLI last reported, as a wire id. */
	private wire: string | undefined;
	/** The model was chosen here since the CLI last reported one, so its next report is the choice taking effect. */
	private chosen: boolean;
	private axis: ModeAxis | undefined;
	private chosenModel: ModelId | undefined;

	/** `model`: the model the session is started on, when the person named one. */
	constructor(
		private readonly deps: SettingsDeps,
		start: { readonly model?: ModelId },
	) {
		this.chosen = start.model !== undefined;
		this.chosenModel = start.model;
	}

	/** The model a process is started on: only one a person chose, never the CLI's own default. */
	get explicitModel(): ModelId | undefined {
		return this.chosenModel;
	}

	/** Loads the permissions axis for `planModeOptions`, which is read synchronously. */
	loadAxis(): void {
		void this.offeredModes().catch(() => undefined);
	}

	planModeOptions(): PlanModeOptions | undefined {
		const options = this.axis?.options.filter((option) => option.value !== "plan") ?? [];
		if (!this.axis || options.length === 0) return undefined;
		const hasDefault = options.some((option) => option.value === DEFAULT_PERMISSION_MODE);
		return {
			axis: this.axis.id,
			options,
			...(hasDefault && { defaultValue: DEFAULT_PERMISSION_MODE }),
		};
	}

	setModel(modelId: ModelId): Promise<ActionResult> {
		return this.deps.locked(async () => {
			if (this.deps.closed()) return CLOSED;
			const summary = await this.deps.catalogue.model(this.deps.cwd, modelId);
			if (summary === undefined) return rejected("not_found", `Claude Code offers no model ${modelId}`);
			if (isRejected(summary)) return summary;
			if (summary.unavailableReason !== undefined) {
				return rejected("invalid_input", `${modelId} cannot be used now: ${summary.unavailableReason}`);
			}
			const query = await this.liveQuery();
			if (isRejected(query)) return query;
			try {
				await query.setModel(modelId);
			} catch (error) {
				return rejected("backend_error", `the model could not be changed: ${errorText(error)}`);
			}
			this.chosen = true;
			this.chosenModel = modelId;
			this.emitModel(modelId, keptThinking(summary, this.deps.live.snapshot().thinking));
			return ACCEPTED;
		});
	}

	setThinking(value: string): Promise<ActionResult> {
		return this.deps.locked(async () => {
			if (this.deps.closed()) return CLOSED;
			const spec = await this.currentSpec();
			if (isRejected(spec)) return spec;
			if (!isEffortLevel(value) || !spec.options.some((option) => option.value === value)) {
				return rejected("invalid_input", `the model does not offer thinking ${value}`);
			}
			const query = await this.liveQuery();
			if (isRejected(query)) return query;
			try {
				await query.applyFlagSettings({ effortLevel: value });
			} catch (error) {
				return rejected("backend_error", `the thinking level could not be changed: ${errorText(error)}`);
			}
			this.emitModel(this.deps.live.snapshot().modelId, value);
			return ACCEPTED;
		});
	}

	setMode(axis: ModeAxisId, value: string): Promise<ActionResult> {
		return this.deps.locked(async () => {
			if (this.deps.closed()) return CLOSED;
			if (axis !== PERMISSIONS_AXIS) return rejected("invalid_input", `Claude Code has no mode ${axis}`);
			const offered = await this.offeredModes();
			if (!isPermissionMode(value) || !offered.has(value)) {
				return rejected("invalid_input", `${axis} has no value ${value}`);
			}
			const query = await this.liveQuery();
			if (isRejected(query)) return query;
			try {
				await query.setPermissionMode(value);
			} catch (error) {
				return rejected("backend_error", `the mode could not be changed: ${errorText(error)}`);
			}
			this.deps.live.emit({
				type: "mode_changed",
				axis: PERMISSIONS_AXIS,
				value,
			});
			return ACCEPTED;
		});
	}

	/** A mode the CLI reports (`init`, `status`): the session is in it whoever chose it, plan approval included. */
	modeFromFrame(value: string): void {
		if (!isPermissionMode(value)) return;
		const shown = this.deps.live.snapshot().modes.find((mode) => mode.axis === PERMISSIONS_AXIS)?.value;
		if (shown !== value)
			this.deps.live.emit({
				type: "mode_changed",
				axis: PERMISSIONS_AXIS,
				value,
			});
	}

	/** The model a turn runs on, as the CLI names it; a choice made here is not undone by an alias that resolves alike. */
	modelFromInit(wire: string): void {
		const same = wire === this.wire;
		const chosen = this.chosen;
		this.wire = wire;
		this.chosen = false;
		if (same || chosen) return;
		void this.resolveWire(wire).catch(() => undefined);
	}

	private async resolveWire(wire: string): Promise<void> {
		const listed = await this.deps.catalogue.listedModelId(this.deps.cwd, wire);
		if (listed === undefined || this.deps.closed() || this.wire !== wire) return;
		const now = this.deps.live.snapshot();
		if (now.modelId !== listed) this.emitModel(listed, now.thinking);
	}

	private async liveQuery(): Promise<Query | Rejected> {
		const failure = await this.deps.ensureProcess();
		if (failure) return failure;
		return this.deps.query() ?? rejected("backend_error", "Claude Code is not running");
	}

	private async currentSpec(): Promise<ThinkingSpec | Rejected> {
		const { catalogue, cwd } = this.deps;
		const modelId = this.deps.live.snapshot().modelId;
		if (modelId !== undefined) {
			const summary = await catalogue.model(cwd, modelId);
			if (summary === undefined) return rejected("not_found", `Claude Code offers no model ${modelId}`);
			return isRejected(summary) ? summary : summary.thinking;
		}
		const listed = await catalogue.models(cwd);
		if (listed.status === "rejected") return listed;
		const fallback = listed.models.find((model) => model.isDefault) ?? listed.models[0];
		return fallback ? fallback.thinking : rejected("not_found", "Claude Code lists no model");
	}

	private async offeredModes(): Promise<Set<string>> {
		const listed = await this.deps.catalogue.modes(this.deps.cwd);
		const axis =
			listed.status === "accepted" ? listed.modes.find((candidate) => candidate.id === PERMISSIONS_AXIS) : undefined;
		if (axis) this.axis = axis;
		return new Set(axis ? axis.options.map((option) => option.value) : PERMISSION_MODES);
	}

	private emitModel(modelId: string | undefined, thinking: string | undefined): void {
		this.deps.live.emit({
			type: "model_changed",
			...(modelId !== undefined && { modelId }),
			...(thinking !== undefined && { thinking }),
		});
	}
}

function keptThinking(model: ModelSummary, thinking: string | undefined): string | undefined {
	return thinking !== undefined && model.thinking.options.some((option) => option.value === thinking)
		? thinking
		: undefined;
}
