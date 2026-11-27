/** Starting one of the user's `agy acp` processes, as both the short jobs and the live front run them. */

import { mkdir } from "node:fs/promises";
import { errorText } from "../../adapter-kit/error-text";
import { AcpConnection } from "./acp/connection";
import type { InitializeResult } from "./acp/frames";
import type { RpcResult } from "./acp/rpc";
import type { AgyInstall } from "./install";

export interface AgyProcess {
	readonly acp: Pick<AcpConnection, "rpc" | "running" | "ended" | "stop">;
	readonly agent: InitializeResult;
}

export interface AgyStart {
	readonly args: readonly string[];
	/** Who the bridge tells `agy` it is: its own name and version, nothing borrowed. */
	readonly client: { readonly name: string; readonly version: string };
	/** Where what `agy` sends that breaks the protocol is reported. */
	readonly log: (message: string) => void;
	/** Stops the process when it aborts. */
	readonly signal: AbortSignal;
}

/** How each `agy acp` the adapter needs is started. */
export type AgyLauncher = (start: AgyStart) => Promise<RpcResult<AgyProcess>>;

export const SHUT_DOWN = { ok: false, failure: { message: "the Antigravity backend has shut down" } } as const;

/** The user's own `agy` from `install`, started by `startAgy`. */
export function installedAgy(install: AgyInstall): AgyLauncher {
	return (start) => startAgy(install, start);
}

/** In the void folder, which is made first; the process leads a group of its own (`adapter-kit/stdio-child.ts`). */
export async function startAgy(install: AgyInstall, start: AgyStart): Promise<RpcResult<AgyProcess>> {
	const { cli, env, voidDir } = install;
	if (!cli.found) return { ok: false, failure: { message: cli.reason } };
	const made = await mkdir(voidDir, { recursive: true }).then(
		() => undefined,
		(error: unknown) => `the bridge could not make ${voidDir}: ${errorText(error)}`,
	);
	if (made !== undefined) return { ok: false, failure: { message: made } };
	if (start.signal.aborted) return SHUT_DOWN;
	const opened = await AcpConnection.open({
		executable: cli.path,
		args: start.args,
		cwd: voidDir,
		env,
		who: "agy",
		client: start.client,
		onFault: start.log,
		signal: start.signal,
	});
	return opened.ok ? { ok: true, result: { acp: opened.result.connection, agent: opened.result.agent } } : opened;
}
