/**
 * The `pi --mode rpc` that hosts one session (`docs/rpc-commands.md`, pi-coding-agent 1.5.2): the commands the host
 * sends it, each a value with its own deadline. A lookup the event stream itself waits on is answered as it arrives;
 * every other answer takes its place among the events (`rpc/client.ts`).
 */

import type { BroskiRecord } from "../broski-entries";
import { recordCommand } from "../host/protocol";
import type { ImageContent } from "../messages";
import { type Deliver, type RpcAnswer, RpcClient } from "../rpc/client";
import {
	CommandsReply,
	EntriesReply,
	Ignored,
	type PiCommand,
	type PiEntry,
	PiModel,
	type PiState,
	type PromptDisposition,
	PromptReply,
	QueueReply,
	type SessionStats,
	StateReply,
	StatsReply,
} from "../rpc/replies";
import type { OpenTransport, PiEnd } from "../rpc/transport";

/** Inside the core's 30 s for an open (`core/deadline.ts`), with the host's end after it. */
export const START_DEADLINE_MS = 20_000;
const LOOKUP_DEADLINE_MS = 10_000;
const COMMAND_DEADLINE_MS = 30_000;
/** `abort` answers once the session is idle (`docs/rpc-commands.md:94-105`). */
export const ABORT_DEADLINE_MS = 10_000;
/** `compact` answers when the compaction has ended; the phone is answered at its start. */
const COMPACT_DEADLINE_MS = 10 * 60_000;

export type StreamingBehavior = "steer" | "followUp";

export interface EntriesSince {
	readonly entries: readonly PiEntry[];
	readonly leafId: string | null;
}

export class PiChild {
	private readonly client: RpcClient;

	constructor(open: OpenTransport, deliver: Deliver) {
		this.client = new RpcClient(open, deliver);
	}

	get ended(): Promise<PiEnd> {
		return this.client.ended;
	}

	get running(): boolean {
		return this.client.running;
	}

	state(): Promise<RpcAnswer<PiState>> {
		return this.client.request({ type: "get_state" }, StateReply, { deadlineMs: LOOKUP_DEADLINE_MS, ordered: false });
	}

	/** The handshake: Pi answers its first command once every extension's `session_start` has returned. */
	started(): Promise<RpcAnswer<PiState>> {
		return this.client.request({ type: "get_state" }, StateReply, { deadlineMs: START_DEADLINE_MS, ordered: false });
	}

	entriesSince(cursor: string | null): Promise<RpcAnswer<EntriesSince>> {
		const command = cursor === null ? { type: "get_entries" } : { type: "get_entries", since: cursor };
		return this.client.request(command, EntriesReply, { deadlineMs: LOOKUP_DEADLINE_MS, ordered: false });
	}

	commands(): Promise<RpcAnswer<readonly PiCommand[]>> {
		return this.client
			.request({ type: "get_commands" }, CommandsReply, { deadlineMs: LOOKUP_DEADLINE_MS, ordered: false })
			.then((answer) => (answer.ok ? { ok: true, data: answer.data.commands } : answer));
	}

	/**
	 * Pi answers once it has decided, and an extension's handler or command may wait on a human for as long as the human
	 * takes: no deadline ends it, only Pi's answer or its exit. The phone is answered earlier, at the run's start
	 * (`pi-prompt.ts`) or by the core's own deadline.
	 */
	prompt(
		message: string,
		images: readonly ImageContent[],
		streamingBehavior?: StreamingBehavior,
	): Promise<RpcAnswer<PromptDisposition>> {
		const command = {
			type: "prompt",
			message,
			...(images.length > 0 && { images }),
			...(streamingBehavior !== undefined && { streamingBehavior }),
		};
		return this.client
			.request(command, PromptReply)
			.then((answer) => (answer.ok ? { ok: true, data: answer.data.disposition } : answer));
	}

	/** Has the bridge's extension append `record` wherever the session's leaf is now (`host/protocol.ts`). */
	record(record: BroskiRecord): Promise<RpcAnswer<unknown>> {
		return this.client.request({ type: "prompt", message: recordCommand(record) }, Ignored, {
			deadlineMs: COMMAND_DEADLINE_MS,
		});
	}

	clearQueue(): Promise<RpcAnswer<{ readonly steering: readonly string[]; readonly followUp: readonly string[] }>> {
		return this.client.request({ type: "clear_queue" }, QueueReply, { deadlineMs: COMMAND_DEADLINE_MS });
	}

	abort(): Promise<RpcAnswer<unknown>> {
		return this.client.request({ type: "abort" }, Ignored, { deadlineMs: ABORT_DEADLINE_MS });
	}

	setModel(provider: string, modelId: string): Promise<RpcAnswer<PiModel>> {
		return this.client.request({ type: "set_model", provider, modelId }, PiModel, { deadlineMs: COMMAND_DEADLINE_MS });
	}

	setThinking(level: string): Promise<RpcAnswer<unknown>> {
		return this.client.request({ type: "set_thinking_level", level }, Ignored, { deadlineMs: COMMAND_DEADLINE_MS });
	}

	setName(name: string): Promise<RpcAnswer<unknown>> {
		return this.client.request({ type: "set_session_name", name }, Ignored, { deadlineMs: COMMAND_DEADLINE_MS });
	}

	compact(instructions: string | undefined): Promise<RpcAnswer<unknown>> {
		const command =
			instructions === undefined ? { type: "compact" } : { type: "compact", customInstructions: instructions };
		return this.client.request(command, Ignored, { deadlineMs: COMPACT_DEADLINE_MS });
	}

	stats(): Promise<RpcAnswer<SessionStats>> {
		return this.client.request({ type: "get_session_stats" }, StatsReply, {
			deadlineMs: LOOKUP_DEADLINE_MS,
			ordered: false,
		});
	}

	/** The answer to an extension's dialog (`docs/rpc-extension-ui.md:172-194`). */
	answerDialog(id: string, answer: { value: string } | { confirmed: boolean } | { cancelled: true }): void {
		this.client.send({ type: "extension_ui_response", id, ...answer });
	}

	stop(): Promise<unknown> {
		return this.client.stop();
	}

	/** This bridge lets go of `pi`, which its holder keeps running (`holder/`). */
	detach(): void {
		this.client.detach();
	}
}
