/**
 * What a host starts from: a new holder with a new `pi` on the session's file (`pi --session <file>`, pi-coding-agent
 * 1.5.2 `docs/cli.md`) and the bridge's extension (`-e`), or the holder an earlier bridge left running, taken over.
 */

import { existsSync } from "node:fs";
import { rejected } from "../../../adapter-kit/rejections";
import type { Rejected, SessionId } from "../../../contract";
import { holderDirs, readMeta, removeStale } from "../holder/holders";
import { HolderLink, type HolderSetup } from "../holder/link";
import { type HelloFrame, HOLDER_VERSION, type HolderMeta, holderDirOf } from "../holder/protocol";
import { ensureHostExtension, PROMPT_NOTE_FLAG } from "../host/install";
import { childEnv, type PiInstall } from "../pi-install";
import type { SessionStore } from "../ports";
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
		args: hostArgs(deps.install, target.file, extension.path),
		env: childEnv(deps.install),
		extension: extension.hash,
	});
	if (typeof launched === "string") return rejected("backend_error", `the session could not be started: ${launched}`);
	return { ...target, ...rest, transport: (sink) => launched.link.start(sink) };
}

/**
 * `pi --session <file> -e <extension>`, and the note for the end of its system prompt as the extension's flag. Not Pi's
 * own `--append-system-prompt`: given on the command line, that replaces the user's `APPEND_SYSTEM.md`
 * (pi-coding-agent 1.5.2 `dist/core/resource-loader.js:495-499`).
 */
export function hostArgs(install: PiInstall, file: string, extension: string): string[] {
	const note = install.appendSystemPrompt;
	return ["--session", file, "-e", extension, ...(note === undefined ? [] : [`--${PROMPT_NOTE_FLAG}=${note}`])];
}

/** Every holder an earlier bridge left: its session `adopt`ed, or, when this bridge cannot read it, stopped. */
export async function adoptLeftHolders(root: string, adopt: (meta: HolderMeta) => Promise<void>): Promise<void> {
	const adoptions = holderDirs(root).map(async (dir) => {
		const meta = readMeta(dir);
		if (meta !== undefined) return adopt(meta);
		const attached = await HolderLink.connect(dir);
		if (attached === "absent") removeStale(dir);
		else if (typeof attached !== "string") await attached.link.stop();
	});
	await Promise.all(adoptions.map((adoption) => adoption.catch(() => undefined)));
}

/**
 * The holder of `sessionId`, attached; undefined when none runs. A directory nothing listens in is left over and goes;
 * a holder that accepts but does not greet may still run `pi` on the file, so the session is refused rather than
 * started a second time; a holder of another version or session is asked to stop, since this bridge cannot take it over.
 */
export async function attachHolder(
	holders: HolderSetup,
	sessionId: SessionId,
): Promise<Attached | Rejected | undefined> {
	const dir = holderDirOf(holders.root, sessionId);
	if (!existsSync(dir)) return undefined;
	const attached = await HolderLink.connect(dir);
	if (attached === "absent") {
		removeStale(dir);
		return undefined;
	}
	if (attached === "silent") return rejected("busy", "the session's Pi is running but not answering yet; try again");
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
			...(hello.runStartedAt !== undefined && { runStartedAt: hello.runStartedAt }),
		},
	};
}
