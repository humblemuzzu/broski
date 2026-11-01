/** The real `ClaudeSdk` (`ports/sdk.ts`), with D36's choice of where the session functions run. */

import { homedir } from "node:os";
import { join } from "node:path";
import { filterEscalatingDefaultMode, query } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSdk, SessionFunctions } from "../ports/sdk";
import { IN_PROCESS } from "./in-process";
import { WorkerSessionFunctions } from "./worker-client";

export interface ClaudeSdkOptions {
	/** Unset: the bridge's own environment decides, in process. Set: a worker whose environment is `env`. */
	readonly configDir?: string;
	/** The environment the CLI gets (`process/env.ts`), which then names `configDir`. */
	readonly env: Readonly<Record<string, string>>;
	/** Tests only: whether this is a `bun build --compile` binary; otherwise read from this module's own URL. */
	readonly compiled?: boolean;
}

export const NO_WORKER_IN_A_COMPILED_BRIDGE =
	"a Claude Code config dir needs the SDK worker, which a compiled bridge does not carry; leave configDir unset (D36)";

function refusing(): SessionFunctions {
	const no = () => Promise.reject(new Error(NO_WORKER_IN_A_COMPILED_BRIDGE));
	return {
		listSessions: no,
		getSessionInfo: no,
		getSessionMessages: no,
		getSubagentMessages: no,
		listSubagents: no,
		forkSession: no,
		renameSession: no,
		resolveSettings: no,
	};
}

function sessionFunctions(options: ClaudeSdkOptions): { fns: SessionFunctions; worker?: WorkerSessionFunctions } {
	const { configDir } = options;
	if (configDir === undefined) return { fns: IN_PROCESS };
	if (options.compiled ?? import.meta.url.includes("/$bunfs/")) return { fns: refusing() };
	const worker = new WorkerSessionFunctions({ ...options.env, CLAUDE_CONFIG_DIR: configDir });
	return { fns: worker, worker };
}

export function createClaudeSdk(options: ClaudeSdkOptions): ClaudeSdk {
	const { configDir } = options;
	const { fns, worker } = sessionFunctions(options);
	let disposed = false;
	const guarded =
		<A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
		(...args: A): Promise<R> =>
			disposed ? Promise.reject(new Error("the Claude Code SDK port was disposed")) : fn(...args);
	return {
		listSessions: guarded(fns.listSessions),
		getSessionInfo: guarded(fns.getSessionInfo),
		getSessionMessages: guarded(fns.getSessionMessages),
		getSubagentMessages: guarded(fns.getSubagentMessages),
		listSubagents: guarded(fns.listSubagents),
		forkSession: guarded(fns.forkSession),
		renameSession: guarded(fns.renameSession),
		resolveSettings: guarded(fns.resolveSettings),
		query: ({ prompt, options: queryOptions }) => query({ prompt, options: queryOptions }),
		filterEscalatingDefaultMode: (resolved) => filterEscalatingDefaultMode(resolved),
		configRoot: () => (configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")).normalize("NFC"),
		dispose: async () => {
			disposed = true;
			await worker?.dispose();
		},
	};
}
