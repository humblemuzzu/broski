/**
 * A live session's turns: one `session/prompt` in flight at a time, as a run or as the phone's compaction. agy 1.5.18
 * ends the first turn the moment a second prompt arrives and gives the second everything streamed after it, so a prompt
 * while a turn is under way is refused `busy` (the bridge's own queue and steer send it once the run has finished;
 * Google's docs call a mid-turn prompt a steer, which is not what agy does). A run starts as its prompt is sent and
 * finishes when agy answers it, with what agy streamed in between, the chunks it still sends after a cancel included.
 */

import { phoneText } from "../../../adapter-kit/phone-text";
import { ACCEPTED, rejected } from "../../../adapter-kit/rejections";
import {
	type ActionResult,
	type AgentEvent,
	type CompactionOutcome,
	MAX_TEXT_CHARS,
	type PromptInput,
	type PromptResult,
	type Rejected,
	type SessionSnapshot,
} from "../../../contract";
import type { PromptResult as PromptAnswer, SessionUpdate, TurnUsage } from "../acp/frames";
import type { AgentCall, RpcResult } from "../acp/rpc";
import { toolState } from "../mapping/tools";
import type { AgyAsks } from "./asks";
import type { PhoneImages } from "./images";
import { compactionEnded, type Ended, lostRun, runEnded, WORKER_STOPPED } from "./outcomes";
import { ToolIds, TurnStream } from "./updates";

/** Accepted prompts remembered for a repeat of the same `clientRequestId`. */
const REMEMBERED_PROMPTS = 1_000;
const COMMAND_STATUS = { completed: "completed", failed: "failed", aborted: "stopped" } as const;

interface Run {
	readonly kind: "run";
	readonly runId: string;
	readonly stream: TurnStream;
	/** The prompt as the transcript shows it, which is where the transcript stops while the run is on. */
	readonly text: string;
	aborting: boolean;
}

/**
 * A compaction is no run, so it shows no block or tool: what agy writes while it compacts becomes the command's output,
 * and its thinking and any tool call it makes are not shown.
 */
interface Compaction {
	readonly kind: "compaction";
	readonly tokensBefore: number | undefined;
	text: string;
	aborting: boolean;
}

type Turn = Run | Compaction;

export interface TurnsDeps {
	readonly sessionId: string;
	readonly asks: AgyAsks;
	readonly images: PhoneImages;
	readonly emit: (event: AgentEvent) => void;
	readonly snapshot: () => SessionSnapshot;
	readonly request: (prompt: readonly object[]) => Promise<RpcResult<PromptAnswer>>;
	readonly cancel: () => void;
	/** The commands agy announced for the session, once it has. */
	readonly commands: () => ReadonlySet<string> | undefined;
	/** The turn's token counts. */
	readonly turnUsage: (usage: TurnUsage) => void;
	/** A turn ended: what was read of the session is stale. Called before its end is emitted. */
	readonly ran: () => void;
	/** A turn ended and its end is out. */
	readonly settled: () => void;
}

export class Turns {
	private turn: Turn | undefined;
	private readonly accepted = new Map<string, PromptResult>();
	private readonly toolIds = new ToolIds();

	constructor(private readonly deps: TurnsDeps) {}

	get busy(): boolean {
		return this.turn !== undefined;
	}

	/** The running prompt as the transcript shows it; undefined when no run is on. */
	get runningPrompt(): string | undefined {
		return this.turn?.kind === "run" ? this.turn.text : undefined;
	}

	prompt(input: PromptInput): PromptResult {
		const known = this.accepted.get(input.clientRequestId);
		if (known !== undefined) return known;
		const refused = this.promptRefusal(input) ?? this.busyRefusal();
		if (refused !== undefined) return refused;
		this.startRun(input);
		const result: PromptResult = { status: "accepted", disposition: "started" };
		this.accepted.set(input.clientRequestId, result);
		for (const oldest of this.accepted.keys()) {
			if (this.accepted.size <= REMEMBERED_PROMPTS) break;
			this.accepted.delete(oldest);
		}
		return result;
	}

	/** `/compact` and the instructions, a turn agy runs as a prompt, shown as a compaction rather than a run. */
	compact(instructions: string | undefined): ActionResult {
		const refused = this.busyRefusal();
		if (refused !== undefined) return refused;
		const turn: Compaction = {
			kind: "compaction",
			tokensBefore: this.deps.snapshot().usage?.contextTokens,
			text: "",
			aborting: false,
		};
		this.turn = turn;
		this.deps.emit({ type: "compaction_started", trigger: "manual" });
		const words = instructions?.trim() ?? "";
		const text = words === "" ? "/compact" : `/compact ${words}`;
		void this.deps.request([{ type: "text", text }]).then((result) => this.compacted(turn, result));
		return ACCEPTED;
	}

	/** `session/cancel`, and every open ask answered as a stopped turn's; the turn ends when agy answers its prompt. */
	abort(): ActionResult {
		const turn = this.turn;
		if (turn === undefined || turn.aborting) return ACCEPTED;
		turn.aborting = true;
		this.deps.cancel();
		this.deps.asks.cancelAll();
		return ACCEPTED;
	}

	update(update: SessionUpdate): void {
		const turn = this.turn;
		if (turn === undefined) return;
		switch (update.sessionUpdate) {
			case "agent_message_chunk":
			case "agent_thought_chunk":
				if (update.content.type !== "text" || update.content.text === undefined) return;
				this.chunk(turn, update.sessionUpdate === "agent_message_chunk" ? "text" : "thinking", update.content.text);
				return;
			case "tool_call":
			case "tool_call_update":
				if (turn.kind === "run" && turn.stream.toolUpdate(update)) this.deps.asks.toolEnded(update.toolCallId);
				return;
		}
	}

	/** An ask of agy's: in the run it blocks, with the tool call it is for as agy reported it so far. */
	call(call: AgentCall): void {
		const run = this.turn?.kind === "run" ? this.turn : undefined;
		const runId = run?.runId;
		if (call.method === "elicitation/create") {
			const agyToolCallId = call.params.toolCallId;
			const known = agyToolCallId === undefined ? undefined : run?.stream.tool(agyToolCallId);
			const place = {
				...(runId && { runId }),
				...(agyToolCallId && { agyToolCallId }),
				...(known && { toolCallId: known.id }),
			};
			this.deps.asks.question(call, place);
			return;
		}
		const fields = call.params.toolCall;
		const known = run?.stream.tool(fields.toolCallId);
		const place = { ...(runId && { runId }), agyToolCallId: fields.toolCallId, ...(known && { toolCallId: known.id }) };
		this.deps.asks.permission(call, place, toolState(fields, known?.state));
	}

	/** The session's process is gone: the turn ends failed, its asks withdrawn. */
	lose(reason: string): void {
		const turn = this.turn;
		if (turn?.kind === "run") this.endRun(turn, { outcome: lostRun(reason) });
		else if (turn?.kind === "compaction") {
			this.endCompaction(turn, { kind: "failed", message: phoneText(`${WORKER_STOPPED}: ${reason}`) });
		}
	}

	private chunk(turn: Turn, kind: "text" | "thinking", text: string): void {
		if (turn.kind === "run") turn.stream.chunk(kind, text);
		else if (kind === "text" && turn.text.length < MAX_TEXT_CHARS) turn.text += text;
	}

	private promptRefusal(input: PromptInput): Rejected | undefined {
		if (input.mode !== "start") return rejected("unsupported", `Antigravity takes no ${input.mode} prompts`);
		if (input.attachments.some((attachment) => attachment.kind !== "image")) {
			return rejected("unsupported", "Antigravity takes images, not files");
		}
		if (input.command === undefined && input.attachments.length === 0 && input.text.trim() === "") {
			return rejected("invalid_input", "the prompt is empty");
		}
		const commands = this.deps.commands();
		if (input.command !== undefined && commands !== undefined && !commands.has(input.command)) {
			return rejected("not_found", `Antigravity has no command /${input.command}`);
		}
		return undefined;
	}

	private busyRefusal(): Rejected | undefined {
		if (this.turn?.kind === "run") return rejected("busy", "Antigravity is still on the turn before");
		if (this.turn?.kind === "compaction") return rejected("busy", "Antigravity is compacting the conversation");
		return undefined;
	}

	private startRun(input: PromptInput): void {
		const sent =
			input.command === undefined ? input.text : `/${input.command}${input.text === "" ? "" : ` ${input.text}`}`;
		const text = phoneText(sent);
		const run: Run = {
			kind: "run",
			runId: crypto.randomUUID(),
			stream: new TurnStream(this.deps.emit, this.toolIds),
			text,
			aborting: false,
		};
		this.turn = run;
		this.deps.emit({ type: "run_started", runId: run.runId, trigger: "prompt" });
		const images = this.deps.images.take(this.deps.sessionId, input, text);
		this.deps.emit({
			type: "user_message",
			messageId: crypto.randomUUID(),
			text,
			attachments: images.refs,
			clientRequestId: input.clientRequestId,
		});
		const prompt = [...(sent === "" ? [] : [{ type: "text", text: sent }]), ...images.blocks];
		void this.deps.request(prompt).then((result) => this.answered(run, result));
	}

	private answered(run: Run, result: RpcResult<PromptAnswer>): void {
		if (this.turn !== run) return;
		if (result.ok && result.result.usage !== undefined) this.deps.turnUsage(result.result.usage);
		this.endRun(run, runEnded(result, run.aborting));
	}

	private compacted(turn: Compaction, result: RpcResult<PromptAnswer>): void {
		if (this.turn !== turn) return;
		if (result.ok && result.result.usage !== undefined) this.deps.turnUsage(result.result.usage);
		const outcome = compactionEnded(result, turn.aborting);
		const before = turn.tokensBefore;
		this.endCompaction(
			turn,
			outcome.kind === "completed" && before !== undefined ? { ...outcome, tokensBefore: before } : outcome,
		);
	}

	/** Every block, tool and ask of the run closes before its `run_finished`. */
	private endRun(run: Run, ended: Ended): void {
		run.stream.close();
		this.deps.asks.turnEnded(run.runId);
		if (ended.notice !== undefined) this.deps.emit({ type: "notice", level: "warning", text: ended.notice });
		this.turn = undefined;
		this.deps.ran();
		this.deps.emit({ type: "run_finished", runId: run.runId, outcome: ended.outcome });
		this.deps.settled();
	}

	private endCompaction(turn: Compaction, outcome: CompactionOutcome): void {
		this.deps.asks.turnEnded(undefined);
		this.turn = undefined;
		this.deps.ran();
		this.deps.emit({ type: "compaction_finished", outcome });
		const text = phoneText(turn.text.trim());
		if (text !== "") {
			this.deps.emit({
				type: "activity",
				activityId: crypto.randomUUID(),
				activity: {
					kind: "command",
					title: "/compact",
					status: COMMAND_STATUS[outcome.kind],
					body: { format: "markdown", text },
				},
			});
		}
		this.deps.settled();
	}
}
