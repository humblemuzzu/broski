/**
 * A hosted session's model, thinking and mode (D9, D14): validated against the listed models and
 * levels, applied without persisting Pi's global defaults, and shown as `model_changed`/`mode_changed`.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { type ActionResult, MAX_LIST_ITEMS, type ModeAxisId, type ModelId } from "../../../contract";
import { PERMISSIONS_ENTRY, type PermissionsRecord, permissionsEntryData } from "../broski-entries";
import { errorText } from "../error-text";
import { modelChanged } from "../mapping/session-events";
import type { ModelCatalogue } from "../models/catalogue";
import { hasWireId, modelWireId } from "../models/model-ids";
import { supportedLevel } from "../models/thinking";
import { isPermissionsMode, modeProblem, type PermissionsMode } from "../modes";
import type { GateHost } from "../ports";
import { ACCEPTED, rejected } from "../rejections";
import { faultEvent } from "./live-notes";
import type { LiveState } from "./live-state";

export interface SessionSettingsDeps {
	readonly session: () => AgentSession;
	readonly live: LiveState;
	readonly models: Pick<ModelCatalogue, "find">;
	/** The model changed, and with it the context window the usage is measured against. */
	readonly modelSwitched: () => void;
}

/** `session.setModel` throws this when the model's provider has no credentials (pi `src/core/agent-session.ts:2542-2544`). */
const NO_CREDENTIALS = "No API key for ";

export class SessionSettings implements GateHost {
	/** Set while this class changes the model or thinking itself: the one `model_changed` it emits at the end says it all. */
	private changing = 0;
	private permissionsMode: PermissionsMode;
	private readonly allowedTools: Set<string>;

	constructor(
		private readonly deps: SessionSettingsDeps,
		permissions: PermissionsRecord,
	) {
		this.permissionsMode = permissions.mode;
		this.allowedTools = new Set(permissions.allowedTools);
	}

	permissions(): PermissionsMode {
		return this.permissionsMode;
	}

	allowed(toolName: string): boolean {
		return this.allowedTools.has(toolName);
	}

	/** Recorded with the mode, so a reopened session still lets the tool through; a failed write leaves it allowed until the host ends. */
	allowForSession(toolName: string): void {
		if (this.allowedTools.has(toolName) || this.allowedTools.size >= MAX_LIST_ITEMS) return;
		this.allowedTools.add(toolName);
		const written = this.record(this.permissionsMode);
		if (written !== undefined) this.deps.live.emit(faultEvent(written));
	}

	/** `session.setModel` without `persist`, so the global default model stays the user's (pi `src/core/agent-session.ts:2541-2562`). */
	async setModel(modelId: ModelId): Promise<ActionResult> {
		const model = await this.deps.models.find(modelId);
		if (!model) return rejected("not_found", `no model ${modelId}`);
		this.changing++;
		try {
			await this.deps.session().setModel(model);
		} catch (error) {
			const message = errorText(error);
			this.reconcile();
			return rejected(message.startsWith(NO_CREDENTIALS) ? "auth" : "backend_error", message);
		} finally {
			this.changing--;
		}
		this.announce();
		this.deps.modelSwitched();
		return ACCEPTED;
	}

	setThinking(value: string): ActionResult {
		const session = this.deps.session();
		if (!session.model) return rejected("no_model", "the session has no model to set thinking on");
		const level = supportedLevel(session.model, value);
		if (level === undefined) return rejected("invalid_input", `the model offers no thinking level ${value}`);
		this.changing++;
		try {
			session.setThinkingLevel(level);
		} finally {
			this.changing--;
		}
		this.announce();
		return ACCEPTED;
	}

	/** The mode is recorded in the session file first, so a reopened session is still guarded (D14). */
	setMode(axis: ModeAxisId, value: string): ActionResult {
		const problem = modeProblem({ axis, value });
		if (problem !== undefined || !isPermissionsMode(value)) {
			return problem ?? rejected("invalid_input", `permissions has no value ${value}`);
		}
		if (value !== this.permissionsMode) {
			const failure = this.record(value);
			if (failure !== undefined) {
				return rejected("backend_error", `the mode could not be written to the session file: ${failure}`);
			}
			this.permissionsMode = value;
		}
		this.deps.live.emit({ type: "mode_changed", axis, value });
		return ACCEPTED;
	}

	/** Pi tells of a thinking level it changed on its own (an extension's); a change made here is announced once, by it. */
	followSession(): void {
		if (this.changing === 0) this.announce();
	}

	/** Pi emits no event for a model an extension set, so the snapshot is compared with the session at run ends. */
	reconcile(): void {
		const session = this.deps.session();
		const snapshot = this.deps.live.snapshot();
		if (snapshot.modelId !== currentModelId(session) || snapshot.thinking !== currentThinking(session)) this.announce();
	}

	private announce(): void {
		const session = this.deps.session();
		this.deps.live.emit(modelChanged(currentModelId(session), currentThinking(session)));
	}

	/** Undefined when written; else why not. */
	private record(mode: PermissionsMode): string | undefined {
		try {
			const data = permissionsEntryData(mode, [...this.allowedTools]);
			this.deps.session().sessionManager.appendCustomEntry(PERMISSIONS_ENTRY, data);
			return undefined;
		} catch (error) {
			return errorText(error);
		}
	}
}

/** The wire id of the session's model; a model whose id does not fit a `ModelId` has none. */
function currentModelId(session: AgentSession): ModelId | undefined {
	const model = session.model;
	return model && hasWireId(model) ? modelWireId(model) : undefined;
}

/** The session's level, when its model offers a choice of levels (README §11.3: a model with none shows no thinking). */
function currentThinking(session: AgentSession): ThinkingLevel | undefined {
	const model = session.model;
	return model !== undefined && supportedLevel(model, session.thinkingLevel) !== undefined
		? session.thinkingLevel
		: undefined;
}
