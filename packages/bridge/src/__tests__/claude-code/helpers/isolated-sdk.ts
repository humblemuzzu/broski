/**
 * A `ClaudeSdk` for one test home. The SDK's session and settings functions read `CLAUDE_CONFIG_DIR` from the
 * environment of the thread they run in, and some read it only after their first `await` (`forkSession`,
 * `renameSession`, `resolveSettings`), so swapping `process.env` around a call would leak into concurrent tests. They
 * run instead in a worker thread started with the home's environment: a Bun worker has its own `process.env`, and the
 * test process's is never written. `query()` needs nothing of the kind, since the CLI gets the home in `Options.env`.
 */

import { Worker } from "node:worker_threads";
import type { ClaudeSdk, SessionFunctions } from "../../../backends/claude-code/ports/sdk";
import { createClaudeSdk } from "../../../backends/claude-code/sdk/claude-sdk";
import type { SessionFunctionName, WorkerCall, WorkerReply } from "./isolated-sdk-protocol";

type Waiter = (reply: WorkerReply) => void;
type ArgsOf<K extends SessionFunctionName> = Parameters<SessionFunctions[K]>;

/** `env` must name the home's `CLAUDE_CONFIG_DIR`; the worker starts on the first call and ends at `dispose()`. */
export function isolatedClaudeSdk(env: Readonly<Record<string, string>>): ClaudeSdk {
	const configDir = env.CLAUDE_CONFIG_DIR;
	if (configDir === undefined) throw new Error("an isolated Claude SDK needs CLAUDE_CONFIG_DIR in its env");
	const real = createClaudeSdk();
	const worker = new WorkerSessionFunctions(env);
	return {
		query: real.query,
		filterEscalatingDefaultMode: real.filterEscalatingDefaultMode,
		listSessions: worker.listSessions,
		getSessionInfo: worker.getSessionInfo,
		getSessionMessages: worker.getSessionMessages,
		getSubagentMessages: worker.getSubagentMessages,
		listSubagents: worker.listSubagents,
		forkSession: worker.forkSession,
		renameSession: worker.renameSession,
		resolveSettings: worker.resolveSettings,
		configRoot: () => configDir.normalize("NFC"),
		dispose: async () => {
			await worker.dispose();
			await real.dispose();
		},
	};
}

class WorkerSessionFunctions implements SessionFunctions {
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
		const worker = new Worker(new URL("./isolated-sdk-worker.ts", import.meta.url), { env: { ...this.env } });
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
