/** A desk over a real `LiveState`, a recording sink and a controllable host: what the desk tests drive. */

import { spyOn } from "bun:test";
import type {
	CanUseTool,
	ElicitationRequest,
	ElicitationResult,
	PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import { LiveState } from "../../../backends/claude-code/live/live-state";
import type { AskDesk, AskHost } from "../../../backends/claude-code/ports/asks";
import type { SessionEmitter } from "../../../backends/claude-code/ports/live";
import { createAskDesk } from "../../../backends/claude-code/ui/desk";
import {
	type AgentEvent,
	emptySnapshot,
	Interaction,
	type InteractionReply,
	type PlanModeOptions,
	type RunId,
	type SinkRecord,
} from "../../../contract";

export type ToolOptions = Parameters<CanUseTool>[2];
export type ToolOptionsInit = Partial<Omit<ToolOptions, "signal" | "requestId">> & {
	requestId?: string;
	/** The CLI passes it; `CanUseTool`'s declared options leave it out. */
	requiresUserInteraction?: boolean;
};

export const PLAN_MODES: PlanModeOptions = {
	axis: "permissions",
	options: [
		{ value: "default", label: "Ask before edits" },
		{ value: "acceptEdits", label: "Accept edits" },
		{ value: "auto", label: "Auto" },
	],
};

export class DeskRig {
	readonly live = new LiveState(emptySnapshot(), () => this.clock);
	readonly records: SinkRecord[] = [];
	readonly aborts: string[] = [];
	desk: AskDesk;
	runId: RunId | undefined = "run-1";
	planModes: PlanModeOptions | undefined = PLAN_MODES;
	clock = 1_000;
	private requests = 0;

	constructor(overrides: Partial<AskHost> = {}) {
		this.live.attach({ emit: (record) => this.records.push(record) });
		const host: AskHost = {
			live: this.live,
			activeRunId: () => this.runId,
			abortRun: async () => {
				this.aborts.push("abort");
			},
			planModeOptions: () => this.planModes,
			now: () => this.clock,
			...overrides,
		};
		this.desk = createAskDesk(host);
	}

	events(): AgentEvent[] {
		return this.records.map((record) => record.event);
	}

	requested(): Interaction[] {
		return this.events().flatMap((event) =>
			event.type === "interaction_requested" ? [Interaction.parse(event.interaction)] : [],
		);
	}

	resolved(): { interactionId: string; reason: string }[] {
		return this.events().flatMap((event) =>
			event.type === "interaction_resolved" ? [{ interactionId: event.interactionId, reason: event.reason }] : [],
		);
	}

	pending(): Interaction[] {
		return this.live.snapshot().interactions;
	}

	tool(
		toolName: string,
		input: Record<string, unknown>,
		init: ToolOptionsInit = {},
		controller = new AbortController(),
	): { promise: Promise<PermissionResult | null>; controller: AbortController; requestId: string } {
		const requestId = init.requestId ?? `req-${++this.requests}`;
		const options: ToolOptions = { toolUseID: `toolu_${requestId}`, ...init, requestId, signal: controller.signal };
		return { promise: this.desk.canUseTool(toolName, input, options), controller, requestId };
	}

	elicit(
		request: ElicitationRequest,
		requestId = `elicit-${++this.requests}`,
		controller = new AbortController(),
	): { promise: Promise<ElicitationResult | null>; controller: AbortController; requestId: string } {
		return {
			promise: this.desk.onElicitation(request, { signal: controller.signal, requestId }),
			controller,
			requestId,
		};
	}

	answer(interaction: Interaction, reply: InteractionReply) {
		return this.desk.answer({ interactionId: interaction.id, reply });
	}

	/** The `index`th interaction requested, once it is (the real CLI raises it on its own time). */
	async requestedAt(index: number, timeoutMs = 20_000): Promise<Interaction> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const found = this.requested()[index];
			if (found) return found;
			await Bun.sleep(5);
		}
		throw new Error(`interaction ${index} was never requested`);
	}

	/** The one interaction requested so far. */
	only(): Interaction {
		const [first, ...rest] = this.requested();
		if (!first || rest.length > 0) throw new Error(`expected one interaction, got ${this.requested().length}`);
		return first;
	}
}

/** The rig's session emitter, but the sink refuses (throws on) events of the given types after the state took them. */
export function throwingLive(source: DeskRig, types: AgentEvent["type"][]): SessionEmitter {
	return {
		snapshot: () => source.live.snapshot(),
		emit: (event, native) => {
			source.live.emit(event, native);
			if (types.includes(event.type)) throw new Error(`the sink refused ${event.type}`);
		},
	};
}

/** Holds back what the desk reports to stderr while a test breaks it on purpose; `restore` hands it all back. */
export function captureProblems(): { lines: string[]; restore: () => void } {
	const lines: string[] = [];
	const spy = spyOn(process.stderr, "write").mockImplementation((chunk) => {
		lines.push(String(chunk));
		return true;
	});
	return { lines, restore: () => spy.mockRestore() };
}

/** Whether `promise` is still pending after the event loop has turned a few times. */
export async function stillPending(promise: Promise<unknown>, turns = 5): Promise<boolean> {
	let settled = false;
	promise.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	for (let turn = 0; turn < turns; turn++) await Bun.sleep(2);
	return !settled;
}
