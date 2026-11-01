/**
 * `SessionFunctions` run in a worker thread whose `process.env` is the one given (D36): the SDK reads
 * `CLAUDE_CONFIG_DIR` from its thread's environment, and a Bun worker has its own. The bridge's `process.env` is never
 * written. The worker starts on the first call and is unref'd, so it never keeps the bridge alive.
 */

import { Worker } from "node:worker_threads";
import type { SessionFunctions } from "../ports/sdk";
import type { SessionFunctionName, WorkerCall, WorkerReply } from "./worker-protocol";

type Waiter = (reply: WorkerReply) => void;
type ArgsOf<K extends SessionFunctionName> = Parameters<SessionFunctions[K]>;

export class WorkerSessionFunctions implements SessionFunctions {
	private worker: Worker | undefined;
	private nextId = 1;
	private readonly waiting = new Map<number, Waiter>();
	private ended = false;

	constructor(private readonly env: Readonly<Record<string, string>>) {}

	listSessions = async (...args: ArgsOf<"listSessions">) => {
		const reply = await this.send({ id: this.nextId++, fn: "listSessions", args });
		if (reply.ok && reply.fn === "listSessions") return reply.value;
		throw failure("listSessions", reply);
	};

	getSessionInfo = async (...args: ArgsOf<"getSessionInfo">) => {
		const reply = await this.send({ id: this.nextId++, fn: "getSessionInfo", args });
		if (reply.ok && reply.fn === "getSessionInfo") return reply.value;
		throw failure("getSessionInfo", reply);
	};

	getSessionMessages = async (...args: ArgsOf<"getSessionMessages">) => {
		const reply = await this.send({ id: this.nextId++, fn: "getSessionMessages", args });
		if (reply.ok && reply.fn === "getSessionMessages") return reply.value;
		throw failure("getSessionMessages", reply);
	};

	getSubagentMessages = async (...args: ArgsOf<"getSubagentMessages">) => {
		const reply = await this.send({ id: this.nextId++, fn: "getSubagentMessages", args });
		if (reply.ok && reply.fn === "getSubagentMessages") return reply.value;
		throw failure("getSubagentMessages", reply);
	};

	listSubagents = async (...args: ArgsOf<"listSubagents">) => {
		const reply = await this.send({ id: this.nextId++, fn: "listSubagents", args });
		if (reply.ok && reply.fn === "listSubagents") return reply.value;
		throw failure("listSubagents", reply);
	};

	forkSession = async (...args: ArgsOf<"forkSession">) => {
		const reply = await this.send({ id: this.nextId++, fn: "forkSession", args });
		if (reply.ok && reply.fn === "forkSession") return reply.value;
		throw failure("forkSession", reply);
	};

	renameSession = async (...args: ArgsOf<"renameSession">) => {
		const reply = await this.send({ id: this.nextId++, fn: "renameSession", args });
		if (reply.ok && reply.fn === "renameSession") return reply.value;
		throw failure("renameSession", reply);
	};

	resolveSettings = async (...args: ArgsOf<"resolveSettings">) => {
		const reply = await this.send({ id: this.nextId++, fn: "resolveSettings", args });
		if (reply.ok && reply.fn === "resolveSettings") return reply.value;
		throw failure("resolveSettings", reply);
	};

	async dispose(): Promise<void> {
		this.ended = true;
		const worker = this.worker;
		this.worker = undefined;
		this.failAll("the SDK worker was disposed");
		if (worker) await worker.terminate();
	}

	private send(call: WorkerCall): Promise<WorkerReply> {
		if (this.ended) return Promise.reject(new Error("the SDK worker was disposed"));
		const worker = this.started();
		return new Promise((resolve) => {
			this.waiting.set(call.id, resolve);
			worker.postMessage(call);
		});
	}

	private started(): Worker {
		if (this.worker) return this.worker;
		const worker = new Worker(new URL("./sdk-worker.ts", import.meta.url), { env: { ...this.env } });
		worker.unref();
		worker.on("message", (reply: WorkerReply) => this.settle(reply));
		worker.on("error", (error: Error) => this.lost(worker, error.message));
		worker.on("exit", (code) => this.lost(worker, `the SDK worker exited with code ${code}`));
		this.worker = worker;
		return worker;
	}

	private settle(reply: WorkerReply): void {
		const waiter = this.waiting.get(reply.id);
		this.waiting.delete(reply.id);
		waiter?.(reply);
	}

	private lost(worker: Worker, message: string): void {
		if (this.worker !== worker) return;
		this.worker = undefined;
		this.failAll(message);
	}

	private failAll(message: string): void {
		for (const [id, waiter] of this.waiting) waiter({ id, fn: "listSessions", ok: false, message });
		this.waiting.clear();
	}
}

function failure(fn: SessionFunctionName, reply: WorkerReply): Error {
	return new Error(reply.ok ? `the SDK worker answered ${reply.fn} to ${fn}` : reply.message);
}
