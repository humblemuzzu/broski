/**
 * The Antigravity `AgentBackend`: the user's own `agy` over its ACP server. Every read is a short job on a plain
 * `agy acp` (`jobs.ts`): the listing, the catalog (`catalog/catalogs.ts`) and a session's history. Live sessions are
 * the live front's (`live/hosts.ts`): their rows stand in the listing in place of agy's, their commands are the ones agy
 * announced to them, and their history is their host's own, read with no job.
 */

import { CliVersion, executableStamp } from "../../adapter-kit/cli-version";
import { type Clock, SYSTEM_CLOCK } from "../../adapter-kit/clock";
import type { FileLock, ImageFitter, JournalOpener } from "../../adapter-kit/ports";
import { rejected } from "../../adapter-kit/rejections";
import type { AgentBackend, BackendHost, Rejected, SessionRef } from "../../contract";
import type { RpcResult } from "./acp/rpc";
import { type AgyLauncher, installedAgy } from "./agy-process";
import { AgyCatalogs } from "./catalog/catalogs";
import { listedModels } from "./catalog/models";
import { catalogProbes } from "./catalog/probe";
import type { AgyInstall } from "./install";
import { ShortJobs } from "./jobs";
import { DEFAULT_MAX_SESSIONS } from "./live/cap";
import { AgyHosts } from "./live/hosts";
import { PhonePrompts } from "./live/phone-prompts";
import { antigravityStatus } from "./status";
import { MadeSessions } from "./store/made";
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
	/** Where the sessions this bridge made are kept across restarts (`store/made.ts`): `~/.broski/antigravity`. */
	readonly journal: JournalOpener;
	/** How each `agy acp` starts; the user's own `agy` from `install` when not given. */
	readonly launch?: AgyLauncher;
	/** How many sessions may be open in `agy` at once. */
	readonly maxSessions?: number;
	/** Where what `agy` sends that breaks the protocol is reported. */
	readonly log: (message: string) => void;
	readonly clock?: Clock;
	/** Told the name of the plan agy says the account is on, each time the catalog reads it. */
	readonly planSeen?: (plan: string) => void;
}

interface Parts {
	readonly install: AgyInstall;
	readonly jobs: ShortJobs;
	readonly catalogs: AgyCatalogs;
	readonly sessions: AgySessions;
	readonly transcripts: AgyTranscripts;
	readonly prompts: PhonePrompts;
	readonly hosts: AgyHosts;
}

export function antigravityBackendOf(options: AntigravityBackendOptions, host: BackendHost): AgentBackend {
	const parts = partsOf(options, host);
	const { install, catalogs, hosts, jobs } = parts;
	const version = install.cli.found ? new CliVersion(install.cli.path, install.env) : undefined;
	return {
		id: "antigravity",
		meta: ANTIGRAVITY_META,
		traits: ANTIGRAVITY_TRAITS,
		status: () => antigravityStatus({ cli: install.cli, version, signIn: () => catalogs.lastSignIn() }),
		...sessionReads(parts),
		...catalogReads(parts),
		open: async (target, sink) => {
			if (target.kind === "new") return hosts.openNew(target.options, sink);
			return isOurs(target.session)
				? hosts.openExisting(target.session.sessionId, sink)
				: notFound(target.session.sessionId);
		},
		dispose: async () => {
			await hosts.dispose();
			await jobs.dispose();
		},
	};
}

function partsOf(options: AntigravityBackendOptions, host: BackendHost): Parts {
	const { install } = options;
	const client = { name: "broski", version: options.bridgeVersion };
	const launch = options.launch ?? installedAgy(install);
	const jobs = new ShortJobs(launch, client, options.log);
	const { cli } = install;
	const clock = options.clock ?? SYSTEM_CLOCK;
	const now = () => clock.now();
	const stamp = async () => (cli.found ? executableStamp(cli.path) : "-");
	const catalogs = new AgyCatalogs(
		catalogProbes(jobs),
		install.voidDir,
		stamp,
		now,
		options.planSeen ?? (() => undefined),
	);
	const made = new MadeSessions(options.journal);
	const sessions = new AgySessions(jobs, install.voidDir, made);
	const prompts = new PhonePrompts(options.fitImage);
	const transcripts = new AgyTranscripts(jobs, sessions, install.voidDir, prompts);
	const hosts = new AgyHosts({
		install,
		launch,
		client,
		fileLock: options.fileLock,
		maxSessions: options.maxSessions ?? DEFAULT_MAX_SESSIONS,
		prompts,
		made,
		sessions,
		transcripts,
		catalogs,
		catalog: host.catalog,
		clock,
		log: options.log,
	});
	return { install, jobs, catalogs, sessions, transcripts, prompts, hosts };
}

/** What agy stored, each session the bridge hosts by its host's row. */
function sessionReads(
	parts: Parts,
): Pick<AgentBackend, "listSessions" | "getSession" | "readTranscript" | "readAttachment"> {
	const { sessions, transcripts, hosts, prompts } = parts;
	return {
		listSessions: (query, page) => sessions.list(query, page, hosts),
		getSession: async (ref) => (isOurs(ref) ? sessions.get(ref.sessionId, hosts) : notFound(ref.sessionId)),
		readTranscript: async (ref, page) =>
			isOurs(ref) ? transcripts.read(ref.sessionId, page, hosts) : notFound(ref.sessionId),
		readAttachment: async (ref, attachment, variant) =>
			isOurs(ref) ? prompts.read(ref.sessionId, attachment, variant ?? "full") : notFound(ref.sessionId),
	};
}

function catalogReads(parts: Parts): Pick<AgentBackend, "listModels" | "listModes" | "listCommands"> {
	const { catalogs, sessions, hosts } = parts;
	return {
		listModels: async (cwd, listOptions) => {
			const read = catalogAnswer(await catalogs.offered(cwd), catalogs);
			if ("rejection" in read) return read;
			return { status: "accepted", models: listedModels(read.models, listOptions?.includeUnavailable === true) };
		},
		listModes: async (cwd) => {
			const read = catalogAnswer(await catalogs.offered(cwd), catalogs);
			return "rejection" in read ? read : { status: "accepted", modes: [...read.modes] };
		},
		listCommands: async (scope) => {
			const announced = scope.session === undefined ? undefined : hosts.host(scope.session.sessionId)?.commandList();
			if (announced !== undefined) return { status: "accepted", commands: announced };
			const cwd = await commandsCwd(sessions, scope);
			if (typeof cwd === "object") return cwd;
			const read = catalogAnswer(await catalogs.commands(cwd), catalogs);
			return "rejection" in read ? read : { status: "accepted", commands: [...read] };
		},
	};
}

function isOurs(ref: SessionRef): boolean {
	return ref.backend === "antigravity";
}

/** A refusal names a sign-in agy lacks as `auth`, so the phone can say what to do. */
function catalogAnswer<T extends object>(read: RpcResult<T>, catalogs: AgyCatalogs): T | Rejected {
	if (read.ok) return read.result;
	const code = catalogs.lastSignIn().kind === "signed_out" ? "auth" : "backend_error";
	return rejected(code, `Antigravity could not read its catalog: ${read.failure.message}`);
}

/**
 * A session's commands are those agy announced to it when the bridge hosts it, else those of a new session in its
 * directory; one whose directory agy did not keep gets those of a session without a project.
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
