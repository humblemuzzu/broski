/**
 * The `agy acp` processes a backend starts, each answering the requests the bridge writes it with what agy answered the
 * same method in a recording (`fixtures/frames/`), or with a record ACP's documentation shows where no recording has
 * one, each named where it is given. A request with no answer here stays unanswered, as a turn a restart cuts off does,
 * until the test answers it late (`answerLate`), as agy answers a turn when it ends.
 * Every record the bridge writes is kept, so a test holds the bridge to what it sent and to nothing more.
 */

import { isRecord } from "../../adapter-kit/bounded-json";
import { InitializeResult } from "../../backends/antigravity/acp/frames";
import { JsonRpc, type RpcResult } from "../../backends/antigravity/acp/rpc";
import type { AgyLauncher, AgyProcess, AgyStart } from "../../backends/antigravity/agy-process";
import { answerTo } from "./replay/recorded";
import { frontOf, jobOf, recording } from "./replay/recordings";

/** A JSON-RPC answer's body: its `result`, or its `error`. */
export type Answer = { readonly result: unknown } | { readonly error: unknown };

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

/** agy's own answers to the short job's `initialize` and `session/list` of the `listing` recording. */
export function recordedListing(): Answers {
	const job = jobOf(recording("listing"));
	return {
		initialize: [{ result: answerTo(job, "initialize") }],
		"session/list": [{ result: answerTo(job, "session/list") }],
	};
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
				const reply = (answer: Answer) =>
					setTimeout(() => rpc.receive({ kind: "line", text: JSON.stringify({ jsonrpc: "2.0", id, ...answer }) }), 0);
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
