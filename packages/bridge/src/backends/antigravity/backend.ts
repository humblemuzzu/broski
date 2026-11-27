/**
 * The Antigravity `AgentBackend`: the user's own `agy` over its ACP server. Every read is a short job on a plain
 * `agy acp` (`jobs.ts`): the listing, each directory's catalog and a session's history. Opening a session is the live
 * layer's, which this backend does not have yet: `open` and `readAttachment` refuse.
 */

import { CliVersion } from "../../adapter-kit/cli-version";
import type { FileLock, ImageFitter } from "../../adapter-kit/ports";
import { rejected } from "../../adapter-kit/rejections";
import type { AgentBackend, Rejected, SessionRef } from "../../contract";
import type { RpcResult } from "./acp/rpc";
import { AgyCatalogs, type Catalog } from "./catalog/catalogs";
import { listedModels } from "./catalog/models";
import type { AgyInstall } from "./install";
import { ShortJobs } from "./jobs";
import { antigravityStatus } from "./status";
import { AgySessions, notFound } from "./store/sessions";
import { AgyTranscripts } from "./store/transcript";
import { ANTIGRAVITY_META, ANTIGRAVITY_TRAITS } from "./traits";

export interface AntigravityBackendOptions {
	readonly install: AgyInstall;
	/** The bridge's version, which `agy` is told with the client's name. */
	readonly bridgeVersion: string;
	/** Takes `agy`'s presence lock for a conversation the phone controls. */
	readonly fileLock: FileLock;
	readonly fitImage: ImageFitter;
	/** How many sessions may be open in `agy` at once. */
	readonly maxSessions?: number;
}

export function antigravityBackendOf(options: AntigravityBackendOptions): AgentBackend {
	const { install } = options;
	const jobs = new ShortJobs(install, { name: "broski", version: options.bridgeVersion });
	const catalogs = new AgyCatalogs(jobs, install.voidDir);
	const sessions = new AgySessions(jobs, install.voidDir);
	const transcripts = new AgyTranscripts(jobs, sessions, install.voidDir);
	const version = install.cli.found ? new CliVersion(install.cli.path, install.env) : undefined;
	const catalog = async (cwd: string | undefined) => catalogAnswer(await catalogs.read(cwd), catalogs);
	return {
		id: "antigravity",
		meta: ANTIGRAVITY_META,
		traits: ANTIGRAVITY_TRAITS,
		status: () => antigravityStatus({ cli: install.cli, version, signIn: () => catalogs.lastSignIn() }),
		listSessions: (query, page) => sessions.list(query, page),
		getSession: async (ref) => (isOurs(ref) ? sessions.get(ref.sessionId) : notFound(ref.sessionId)),
		readTranscript: async (ref, page) =>
			isOurs(ref) ? transcripts.read(ref.sessionId, page) : notFound(ref.sessionId),
		readAttachment: async (_ref, attachment) => rejected("not_found", `no Antigravity attachment ${attachment}`),
		listModels: async (cwd, listOptions) => {
			const read = await catalog(cwd);
			if ("rejection" in read) return read;
			return { status: "accepted", models: listedModels(read.models, listOptions?.includeUnavailable === true) };
		},
		listModes: async (cwd) => {
			const read = await catalog(cwd);
			return "rejection" in read ? read : { status: "accepted", modes: [...read.modes] };
		},
		listCommands: async (scope) => {
			const cwd = await commandsCwd(sessions, scope);
			if (typeof cwd === "object") return cwd;
			const read = await catalog(cwd);
			return "rejection" in read ? read : { status: "accepted", commands: [...read.commands] };
		},
		open: async () => rejected("unsupported", "the bridge cannot open Antigravity sessions yet"),
		dispose: () => jobs.dispose(),
	};
}

function isOurs(ref: SessionRef): boolean {
	return ref.backend === "antigravity";
}

/** A refusal names a sign-in agy lacks as `auth`, so the phone can say what to do. */
function catalogAnswer(read: RpcResult<Catalog>, catalogs: AgyCatalogs): Catalog | Rejected {
	if (read.ok) return read.result;
	const code = catalogs.lastSignIn().kind === "signed_out" ? "auth" : "backend_error";
	return rejected(code, `Antigravity could not open a session: ${read.failure.message}`);
}

/**
 * A session's commands are those of a new session in its directory; one whose directory agy did not keep gets those of
 * a session without a project.
 */
async function commandsCwd(
	sessions: AgySessions,
	scope: { cwd?: string; session?: SessionRef },
): Promise<string | undefined | Rejected> {
	if (scope.session === undefined) return scope.cwd;
	if (!isOurs(scope.session)) return notFound(scope.session.sessionId);
	const found = await sessions.find(scope.session.sessionId);
	if (!found.ok) return rejected("backend_error", `Antigravity could not list its sessions: ${found.failure.message}`);
	return found.result === undefined ? notFound(scope.session.sessionId) : found.result.cwd;
}
