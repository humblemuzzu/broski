/**
 * The `agy acp` processes a backend starts, each answering the requests the bridge writes it with what agy answered the
 * same method in a recording (`fixtures/frames/`), or with a record ACP's documentation shows where no recording has
 * one, each named where it is given. A request with no answer here stays unanswered, as a turn a restart cuts off does,
 * until the test answers it late (`answerLate`), as agy answers a turn when it ends. An answer may carry the
 * `session/update`s agy writes ahead of it: a turn's stream, a load's replay.
 * Every record the bridge writes is kept, so a test holds the bridge to what it sent and to nothing more.
 */

import { isRecord } from "../../adapter-kit/bounded-json";
import { InitializeResult } from "../../backends/antigravity/acp/frames";
import { JsonRpc, type RpcResult } from "../../backends/antigravity/acp/rpc";
import type { AgyLauncher, AgyProcess, AgyStart } from "../../backends/antigravity/agy-process";
import type { RecordedAgy } from "./record/scrub";
import { answerTo } from "./replay/recorded";
import { frontOf, jobOf, recording } from "./replay/recordings";
import { isAnswer } from "./replay/replay";

/** A JSON-RPC answer's body, its `result` or its `error`, and the params of the `session/update`s written before it. */
export type Answer = ({ readonly result: unknown } | { readonly error: unknown }) & {
	readonly updates?: readonly unknown[];
};

/** Per method, the answers its requests get, in turn. */
export type Answers = Readonly<Record<string, readonly Answer[]>>;

export interface Written {
	readonly front: boolean;
	readonly method: string;
	readonly params: Readonly<Record<string, unknown>>;
}

/** ACP's answer to a `session/load` of a session the agent does not have (protocol/v1/error, "Unknown sessions"). */
export function unknownSession(sessionId: string): Answer {
	return { error: { code: -32002, message: "Resource not found", data: { sessionId } } };
}

/**
 * agy's own answers to the short job's `initialize` and `session/list` of the `listing` recording, its workspace at
 * `workspace` when one is named.
 */
export function recordedListing(workspace?: string): Answers {
	const job = jobOf(recording("listing", workspace));
	return {
		initialize: [{ result: answerTo(job, "initialize") }],
		"session/list": [{ result: answerTo(job, "session/list") }],
	};
}

/**
 * agy's own answer to the first request of `method` the bridge sent `agy` in a recording, with the `session/update`s it
 * wrote between the two, retold of session `sessionId`.
 */
export function recordedAnswer(agy: RecordedAgy, method: string, sessionId: string): Answer {
	const sent = agy.frames.findIndex((frame) => frame.from === "client" && frame.message.method === method);
	const id = agy.frames[sent]?.message.id;
	const after = agy.frames.slice(sent + 1);
	const end = after.findIndex((frame) => frame.from === "agent" && isAnswer(frame.message) && frame.message.id === id);
	if (sent < 0 || end < 0) throw new Error(`the recording shows no answered ${method}`);
	const updates = after
		.slice(0, end)
		.filter((frame) => frame.from === "agent" && frame.message.method === "session/update")
		.map((frame) => ({ ...(isRecord(frame.message.params) ? frame.message.params : {}), sessionId }));
	return { result: answerTo(agy, method), updates };
}

/** agy's own answer to the live front's `initialize` of the `plain-turn` recording. */
export function recordedFrontInitialize(): Answer {
	return { result: answerTo(frontOf(recording("plain-turn")), "initialize") };
}

export class AnsweringAgy {
	readonly written: Written[] = [];
	private readonly left: Map<string, Answer[]>[];
	private readonly unanswered: Array<{ readonly method: string; readonly reply: (answer: Answer) => void }> = [];

	constructor(
		/** The front's answers, then the short jobs'. */
		front: Answers,
		job: Answers,
	) {
		this.left = [front, job].map(
			(answers) => new Map(Object.entries(answers).map(([method, all]) => [method, [...all]])),
		);
	}

	readonly launch: AgyLauncher = async (start) => this.started(start);

	/** The methods the bridge sent the front or the jobs, in order. */
	sent(front: boolean): string[] {
		return this.written.filter((record) => record.front === front).map((record) => record.method);
	}

	/** Answers the oldest request of `method` that had no answer here. */
	answerLate(method: string, answer: Answer): void {
		const index = this.unanswered.findIndex((request) => request.method === method);
		if (index < 0) throw new Error(`no ${method} waits for an answer`);
		this.unanswered.splice(index, 1)[0]?.reply(answer);
	}

	private started(start: AgyStart): RpcResult<AgyProcess> {
		const front = start.args.includes("--process-per-session");
		const answers = this.left[front ? 0 : 1] ?? new Map<string, Answer[]>();
		const initialize = answers.get("initialize")?.shift();
		if (initialize === undefined || !("result" in initialize)) {
			return { ok: false, failure: { message: "no initialize answer left" } };
		}
		let running = true;
		const rpc: JsonRpc = new JsonRpc(
			"agy",
			(record) => {
				const message: unknown = JSON.parse(record);
				if (!isRecord(message) || typeof message.method !== "string") return;
				const { id, method, params } = message;
				this.written.push({ front, method, params: isRecord(params) ? params : {} });
				if (id === undefined) return;
				const reply = ({ updates = [], ...answer }: Answer) =>
					setTimeout(() => {
						for (const params of updates) {
							rpc.receive({ kind: "line", text: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params }) });
						}
						rpc.receive({ kind: "line", text: JSON.stringify({ jsonrpc: "2.0", id, ...answer }) });
					}, 0);
				const answer = answers.get(method)?.shift();
				if (answer === undefined) this.unanswered.push({ method, reply });
				else reply(answer);
			},
			start.log,
		);
		const acp = {
			rpc,
			get running() {
				return running;
			},
			ended: new Promise<string>(() => undefined),
			stop: async () => {
				running = false;
				rpc.close("agy was stopped");
			},
		};
		return { ok: true, result: { acp, agent: InitializeResult.parse(initialize.result) } };
	}
}
