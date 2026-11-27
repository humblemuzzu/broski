/**
 * A hosted session's model, thinking and mode: checked against the listed models and levels, applied through Pi's own
 * `set_model` and `set_thinking_level`, which change the session alone (Pi's defaults stay the user's, pi-coding-agent
 * 1.5.2 `dist/modes/rpc/rpc-mode.js:387-395, 410-413`), and shown as `model_changed`/`mode_changed`. The permissions
 * mode is the bridge's extension's (`host/extension/`), which keeps it in the session file.
 */

import type { LiveState } from "../../../adapter-kit/live-state";
import { ACCEPTED, rejected } from "../../../adapter-kit/rejections";
import type { ActionResult, ModeAxisId, ModelId } from "../../../contract";
import { type PermissionsRecord, permissionsRecord } from "../broski-entries";
import { modelChanged } from "../mapping/session-events";
import type { ModelCatalogue } from "../models/catalogue";
import { hasWireId, modelWireId } from "../models/model-ids";
import { supportedLevel } from "../models/thinking";
import { isPermissionsMode, modeProblem, type PermissionsMode } from "../modes";
import { type PiModel, type PiState, selectedModel } from "../rpc/replies";
import type { PiChild } from "./pi-child";

export interface SessionSettingsDeps {
	readonly child: PiChild;
	readonly live: LiveState;
	readonly models: Pick<ModelCatalogue, "find" | "missing">;
	readonly cwd: string;
	/** The model changed, and with it the context window the usage is measured against. */
	readonly modelSwitched: () => void;
}

/** What `set_model` refuses with when the model's provider has no credentials (`dist/core/agent-session.js:2110-2112`). */
const NO_CREDENTIALS = "No API key for ";

export class SessionSettings {
	private model: PiModel | undefined;
	private thinking = "off";
	/** Set while this class changes the model or thinking itself: the one `model_changed` it emits at the end says it all. */
	private changing = 0;
	private mode: PermissionsMode;
	private readonly allowedTools: Set<string>;

	constructor(
		private readonly deps: SessionSettingsDeps,
		permissions: PermissionsRecord,
	) {
		this.mode = permissions.mode;
		this.allowedTools = new Set(permissions.allowedTools);
	}

	get currentModel(): PiModel | undefined {
		return this.model;
	}

	/** What Pi says the session runs: at its start, and at a run's end, when an extension may have changed either. */
	follow(state: Pick<PiState, "model" | "thinkingLevel">): void {
		const before = `${this.modelId() ?? ""}|${this.shownThinking() ?? ""}`;
		this.model = selectedModel(state);
		this.thinking = state.thinkingLevel;
		if (`${this.modelId() ?? ""}|${this.shownThinking() ?? ""}` !== before) this.announce();
	}

	/** Pi tells of a thinking level that changed (`thinking_level_changed`); a change made here is announced once, by it. */
	thinkingChanged(level: string): void {
		this.thinking = level;
		if (this.changing === 0) this.announce();
	}

	async setModel(modelId: ModelId): Promise<ActionResult> {
		const model = await this.deps.models.find(modelId, this.deps.cwd);
		if (!model) return this.deps.models.missing(modelId);
		this.changing++;
		const answer = await this.deps.child.setModel(model.provider, model.id);
		this.changing--;
		if (!answer.ok) return rejected(answer.error.startsWith(NO_CREDENTIALS) ? "auth" : "backend_error", answer.error);
		this.model = answer.data;
		this.announce();
		this.deps.modelSwitched();
		return ACCEPTED;
	}

	async setThinking(value: string): Promise<ActionResult> {
		const model = this.model;
		if (!model) return rejected("no_model", "the session has no model to set thinking on");
		const level = supportedLevel(model, value);
		if (level === undefined) return rejected("invalid_input", `the model offers no thinking level ${value}`);
		this.changing++;
		const answer = await this.deps.child.setThinking(level);
		this.changing--;
		if (!answer.ok) return rejected("backend_error", answer.error);
		this.thinking = level;
		this.announce();
		return ACCEPTED;
	}

	/** The mode is written to the session file by the extension, which guards the session by it from then on. */
	async setMode(axis: ModeAxisId, value: string): Promise<ActionResult> {
		const problem = modeProblem({ axis, value });
		if (problem !== undefined || !isPermissionsMode(value)) {
			return problem ?? rejected("invalid_input", `permissions has no value ${value}`);
		}
		if (value !== this.mode) {
			const written = await this.deps.child.record(
				permissionsRecord({ mode: value, allowedTools: [...this.allowedTools] }),
			);
			if (!written.ok)
				return rejected("backend_error", `the mode could not be written to the session: ${written.error}`);
			this.mode = value;
		}
		this.deps.live.emit({ type: "mode_changed", axis, value });
		return ACCEPTED;
	}

	/** The human allowed a tool for the session; the extension has recorded it. */
	allowedForSession(toolName: string): void {
		this.allowedTools.add(toolName);
	}

	private announce(): void {
		this.deps.live.emit(modelChanged(this.modelId(), this.shownThinking()));
	}

	/** The wire id of the session's model; a model whose id does not fit a `ModelId` has none. */
	private modelId(): ModelId | undefined {
		return this.model && hasWireId(this.model) ? modelWireId(this.model) : undefined;
	}

	/** The level, when the model offers a choice of levels (README §11.3: a model with none shows no thinking). */
	private shownThinking(): string | undefined {
		return this.model !== undefined && supportedLevel(this.model, this.thinking) !== undefined
			? this.thinking
			: undefined;
	}
}
