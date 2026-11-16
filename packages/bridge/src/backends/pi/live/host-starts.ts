/**
 * What a host starts from: a new holder with a new `pi` on the session's file (`pi --session <file>`, pi-coding-agent
 * 1.5.2 `docs/cli.md`) and the bridge's extension (`-e`), or the holder an earlier bridge left running, taken over.
 */

import { existsSync } from "node:fs";
import type { Rejected, SessionId } from "../../../contract";
import { removeStale } from "../holder/holders";
import { HolderLink, type HolderSetup } from "../holder/link";
import { type HelloFrame, HOLDER_VERSION, holderDirOf } from "../holder/protocol";
import { ensureHostExtension } from "../host/install";
import { childEnv, type PiInstall } from "../pi-install";
import type { SessionStore } from "../ports";
import { rejected } from "../rejections";
import type { HostStart } from "./host-environment";
import { factsOf } from "./hosted-session";

export interface HostStartDeps {
	readonly install: PiInstall;
	readonly hostDir: string;
	readonly holders: HolderSetup;
	readonly store: SessionStore;
	readonly now: () => number;
}

export interface Attached {
	readonly link: HolderLink;
	readonly hello: HelloFrame;
}

/** The session's file and directory, as `pi` is started on them. */
export interface Target {
	readonly sessionId: SessionId;
	readonly cwd: string;
	readonly file: string;
	readonly lastEntryId: string | null;
}

/** A new holder, started and attached, with its `pi` on `target`. */
export async function launchedStart(
	deps: HostStartDeps,
	target: Target,
	rest: Pick<HostStart, "permissions" | "facts">,
): Promise<HostStart | Rejected> {
	const { cli } = deps.install;
	if (!cli.found) return rejected("backend_error", cli.reason);
	const extension = ensureHostExtension(deps.hostDir);
	if ("problem" in extension) return rejected("backend_error", extension.problem);
	const launched = await HolderLink.launch(deps.holders, {
		version: HOLDER_VERSION,
		sessionId: target.sessionId,
		file: target.file,
		cwd: target.cwd,
		cliPath: cli.path,
		args: ["--session", target.file, "-e", extension.path],
		env: childEnv(deps.install),
		extension: extension.hash,
	});
	if (typeof launched === "string") return rejected("backend_error", `the session could not be started: ${launched}`);
	return { ...target, ...rest, transport: (sink) => launched.link.start(sink) };
}

/**
 * The holder of `sessionId`, attached; undefined when none runs. A directory nothing answers in is left over and goes;
 * a holder of another version or session is asked to stop, since this bridge cannot take it over.
 */
export async function attachHolder(holders: HolderSetup, sessionId: SessionId): Promise<Attached | undefined> {
	const dir = holderDirOf(holders.root, sessionId);
	if (!existsSync(dir)) return undefined;
	const attached = await HolderLink.connect(dir);
	if (attached === undefined) {
		removeStale(dir);
		return undefined;
	}
	if (attached.hello.version === HOLDER_VERSION && attached.hello.sessionId === sessionId) return attached;
	await attached.link.stop();
	return undefined;
}

/** A host over a holder's `pi`: the session as the store reads it, and what the holder's replay needs. */
export async function adoptedStart(
	deps: HostStartDeps,
	sessionId: SessionId,
	{ link, hello }: Attached,
): Promise<HostStart | Rejected> {
	const stored = await deps.store.locate(sessionId);
	if ("status" in stored) return stored;
	const { cwd } = stored;
	if (cwd === undefined) return rejected("not_found", "the session records no working directory");
	const facts = await deps.store.facts(stored);
	if ("status" in facts) return facts;
	const recent = await deps.store.recent(stored);
	if ("status" in recent) return recent;
	const extension = ensureHostExtension(deps.hostDir);
	return {
		cwd,
		file: stored.path,
		lastEntryId: facts.lastEntryId,
		transport: (sink) => link.start(sink),
		permissions: facts.permissions,
		facts: factsOf(stored, cwd, facts, deps.now()),
		adoption: {
			seed: recent.entries,
			prompts: recent.prompts,
			truncated: hello.truncated,
			retiring: !("hash" in extension) || extension.hash !== hello.extension,
		},
	};
}
