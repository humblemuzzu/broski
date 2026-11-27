/**
 * The Antigravity `AgentBackend`: the user's own `agy` over its ACP server. Every read is a short job on a plain
 * `agy acp` (`jobs.ts`): the listing, the catalog (`catalog/catalogs.ts`) and a session's history. Live sessions are
 * the live front's (`live/hosts.ts`), whose rows, commands and running turns the reads lay over what agy stored.
 */

import { CliVersion, executableStamp } from "../../adapter-kit/cli-version";
import type { FileLock, ImageFitter } from "../../adapter-kit/ports";
import { rejected } from "../../adapter-kit/rejections";
import type {
	AgentBackend,
	BackendHost,
	PageRequest,
	Rejected,
	SessionRef,
	SessionSummary,
	TranscriptReadResult,
} from "../../contract";
import type { RpcResult } from "./acp/rpc";
import { AgyCatalogs } from "./catalog/catalogs";
import { listedModels } from "./catalog/models";
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
	/** How many sessions may be open in `agy` at once. */
	readonly maxSessions?: number;
	/** Where what `agy` sends that breaks the protocol is reported. */
	readonly log: (message: string) => void;
	readonly now?: () => number;
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
	const jobs = new ShortJobs(install, client, options.log);
	const { cli } = install;
	const catalogs = new AgyCatalogs(jobs, install.voidDir, async () => (cli.found ? executableStamp(cli.path) : "-"));
	const made = new MadeSessions();
	const sessions = new AgySessions(jobs, install.voidDir, made);
	const transcripts = new AgyTranscripts(jobs, sessions, install.voidDir);
	const prompts = new PhonePrompts(options.fitImage);
	const hosts = new AgyHosts({
		install,
		client,
		fileLock: options.fileLock,
		maxSessions: options.maxSessions ?? DEFAULT_MAX_SESSIONS,
		prompts,
		made,
		sessions,
		transcripts,
		catalogs,
		catalog: host.catalog,
		now: options.now ?? Date.now,
		log: options.log,
	});
	return { install, jobs, catalogs, sessions, transcripts, prompts, hosts };
}

/** What agy stored, with the rows of the sessions the bridge hosts as they are now. */
function sessionReads(
	parts: Parts,
): Pick<AgentBackend, "listSessions" | "getSession" | "readTranscript" | "readAttachment"> {
	const { sessions, hosts, prompts } = parts;
	const live = (summary: SessionSummary) => hosts.row(summary.session.sessionId) ?? summary;
	return {
		listSessions: async (query, page) => {
			const listed = await sessions.list(query, page);
			if (listed.status === "rejected") return listed;
			return { ...listed, page: { ...listed.page, items: listed.page.items.map(live) } };
		},
		getSession: async (ref) => {
			if (!isOurs(ref)) return notFound(ref.sessionId);
			const row = hosts.row(ref.sessionId);
			return row !== undefined ? { status: "accepted", summary: row } : sessions.get(ref.sessionId);
		},
		readTranscript: async (ref, page) =>
			isOurs(ref) ? transcriptOf(parts, ref.sessionId, page) : notFound(ref.sessionId),
		readAttachment: async (ref, attachment, variant) =>
			isOurs(ref) ? prompts.read(ref.sessionId, attachment, variant ?? "full") : notFound(ref.sessionId),
	};
}

/** A session the bridge made that agy does not list yet (it lists none before its first prompt) has no history. */
async function transcriptOf(parts: Parts, sessionId: string, page: PageRequest): Promise<TranscriptReadResult> {
	const read = await parts.transcripts.read(sessionId, page, parts.hosts.shown(sessionId));
	const unlisted = read.status === "rejected" && read.rejection.code === "not_found";
	return unlisted && parts.hosts.row(sessionId) !== undefined
		? { status: "accepted", page: { items: [], idStability: "positional" } }
		: read;
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
	return rejected(code, `Antigravity could not open a session: ${read.failure.message}`);
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
