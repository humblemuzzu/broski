/**
 * The Pi `AgentBackend`: every method delegates to the part that owns it. Reads go to the store with the hosted
 * sessions' live facts laid over them; a hosted session is written only through its `pi`.
 */

import { stat } from "node:fs/promises";
import { CliVersion } from "../../adapter-kit/cli-version";
import { imageRead } from "../../adapter-kit/image-read";
import type { AgentBackend, BackendHost, CommandsListResult, Rejected, SessionRef } from "../../contract";
import { PiCatalogs } from "./catalog/catalogs";
import { CatalogFeed } from "./catalog-feed";
import { commandSummaries } from "./commands";
import { ConfigWatch } from "./config-watch";
import type { HolderSetup } from "./holder/link";
import { parseChildSessionId } from "./ids";
import { openChildSession } from "./live/child-open";
import { LiveImageCache } from "./live/image-cache";
import { SessionHosts } from "./live/session-hosts";
import { ModelCatalogue } from "./models/catalogue";
import { listPiModes } from "./modes";
import type { PiInstall } from "./pi-install";
import type { ImageFitter, SessionStore } from "./ports";
import { rejected } from "./rejections";
import type { PiCommand } from "./rpc/replies";
import { piStatus } from "./status";
import { createSessionStore } from "./store/session-store";
import { TerminalLink, type TerminalLinkOptions } from "./terminal/link";
import { PI_META, PI_TRAITS } from "./traits";

export interface PiBackendOptions {
	readonly install: PiInstall;
	/** Where the bridge writes its extension for the `pi` processes it starts (`host/install.ts`). */
	readonly hostDir: string;
	/** Where the holders of hosted sessions live, and how to start one (`holder/`). */
	readonly holders: HolderSetup;
	/** The link to terminal `pi` processes (`terminal/link.ts`); without it the adapter installs and listens to nothing. */
	readonly link?: TerminalLinkOptions;
	/** How many `pi` processes may be hosted at once (`live/host-capacity.ts`). */
	readonly maxHosted?: number;
	readonly fitImage?: ImageFitter;
}

/** The parts one Pi backend is made of, which `piBackendOf` puts behind the contract. */
export interface PiParts {
	readonly catalog: CatalogFeed;
	readonly catalogs: PiCatalogs;
	readonly store: SessionStore;
	readonly models: ModelCatalogue;
	readonly hosts: SessionHosts;
	readonly config: ConfigWatch;
	readonly terminal: TerminalLink;
	readonly images: LiveImageCache;
	readonly fitImage?: ImageFitter;
	readonly status: () => ReturnType<typeof piStatus>;
}

export function createPiParts(host: BackendHost, options: PiBackendOptions): PiParts {
	const { install } = options;
	const { agentDir } = install;
	const catalog = new CatalogFeed(host.catalog);
	const catalogs = new PiCatalogs(install);
	const images = new LiveImageCache();
	const store = createSessionStore({
		agentDir,
		catalog,
		now: Date.now,
		...(options.fitImage !== undefined && { fitImage: options.fitImage }),
	});
	const models = new ModelCatalogue(catalogs);
	const terminal = new TerminalLink(agentDir, options.link, {
		now: Date.now,
		busy: (sessionId) => hosts.isBusy(sessionId),
		changed: (sessionId, path) => announce(sessionId, path),
	});
	const hosts: SessionHosts = new SessionHosts({
		install,
		hostDir: options.hostDir,
		holders: options.holders,
		terminals: terminal.registry,
		models,
		store,
		catalog,
		now: Date.now,
		images,
		...(options.maxHosted !== undefined && { maxHosted: options.maxHosted }),
		busyChanged: (sessionId, busy) => terminal.hosted(sessionId, busy),
	});
	/** A session a terminal runs shows its run in the list. Not before it has a file: a store asked for an id no file holds keeps saying so for a while. */
	const announce = (sessionId: string, path: string): void => {
		void stat(path)
			.then(() => store.get(sessionId, hosts))
			.then((found) => {
				if (found.status === "accepted") catalog.emit({ type: "session_updated", summary: found.summary });
			})
			.catch(() => undefined);
	};
	const version = install.cli.found ? new CliVersion(install.cli.path, install.env) : undefined;
	const status = () => piStatus({ cli: install.cli, version, catalogs, linkProblem: () => terminal.problem() });
	const config = new ConfigWatch(agentDir, catalog, status);
	store.watch(hosts);
	config.attach();
	return {
		catalog,
		catalogs,
		store,
		models,
		hosts,
		config,
		terminal,
		images,
		...(options.fitImage !== undefined && { fitImage: options.fitImage }),
		status,
	};
}

export function piBackendOf(parts: PiParts): AgentBackend {
	const { catalog, store, models, hosts, config, terminal, images, fitImage } = parts;
	return {
		id: "pi",
		meta: PI_META,
		traits: PI_TRAITS,
		status: () => {
			config.attach();
			return parts.status();
		},
		listSessions: async (query, page) => {
			await hosts.adopted();
			return store.list(query, page, hosts);
		},
		getSession: async (ref) => {
			await hosts.adopted();
			return ref.backend === "pi" ? store.get(ref.sessionId, hosts) : notFound(ref);
		},
		readTranscript: async (ref, page) => {
			await hosts.adopted();
			return ref.backend === "pi" ? store.transcript(ref.sessionId, page, hosts) : notFound(ref);
		},
		readAttachment: async (ref, id, variant) => {
			if (ref.backend !== "pi") return notFound(ref);
			const cached = images.get(ref.sessionId, id);
			if (cached !== undefined) {
				return imageRead(cached, variant ?? "full", fitImage, cached.name);
			}
			return store.attachment(ref.sessionId, id, variant);
		},
		listModels: (cwd, options) => models.list(cwd, options),
		listCommands: (scope) => commandsOf(parts, scope),
		listModes: async () => listPiModes(),
		open: async (target, sink) => {
			if (target.kind === "existing" && target.session.backend !== "pi") return notFound(target.session);
			const child = target.kind === "existing" ? parseChildSessionId(target.session.sessionId) : undefined;
			if (target.kind === "existing" && child !== undefined) {
				return openChildSession({ hosts, store }, target.session, child, sink);
			}
			return hosts.open(target, sink);
		},
		rename: async (ref, title) =>
			ref.backend === "pi"
				? hosts.rename(ref.sessionId, title, (name) => store.rename(ref.sessionId, name))
				: notFound(ref),
		delete: async (ref) =>
			ref.backend === "pi"
				? hosts.remove(ref.sessionId, (release) => store.remove(ref.sessionId, release))
				: notFound(ref),
		fork: async (ref, at) => (ref.backend === "pi" ? store.fork(ref.sessionId, at, hosts) : notFound(ref)),
		dispose: async () => {
			store.dispose();
			config.stop();
			await terminal.stop();
			await hosts.dispose();
			catalog.silence();
		},
	};
}

/** A hosted session's own `pi` knows the commands it loaded; else a `pi` already hosting that directory, else a probe. */
async function commandsOf(
	{ catalogs, store, hosts }: PiParts,
	scope: { cwd?: string; session?: SessionRef },
): Promise<CommandsListResult> {
	if (scope.session !== undefined && scope.session.backend !== "pi") return notFound(scope.session);
	const hosted = scope.session === undefined ? undefined : hosts.host(scope.session.sessionId);
	if (hosted !== undefined) return listed(await hosted.commands());
	const cwd = scope.session === undefined ? scope.cwd : await cwdOf(store, scope.session.sessionId);
	if (typeof cwd === "object") return cwd;
	const neighbour = cwd === undefined ? undefined : hosts.inDirectory(cwd);
	if (neighbour !== undefined) return listed(await neighbour.commands());
	const read = await catalogs.read(cwd);
	return listed("failure" in read ? { ok: false, error: read.failure } : { ok: true, data: read.commands });
}

type Answer =
	| { readonly ok: true; readonly data: readonly PiCommand[] }
	| { readonly ok: false; readonly error: string };

function listed(answer: Answer): CommandsListResult {
	return answer.ok
		? { status: "accepted", commands: commandSummaries(answer.data) }
		: rejected("backend_error", `Pi could not list its commands: ${answer.error}`);
}

/** The directory a stored session runs in, whose commands a new session there would have. */
async function cwdOf(store: SessionStore, sessionId: string): Promise<string | undefined | Rejected> {
	const stored = await store.locate(sessionId);
	return "status" in stored ? stored : stored.cwd;
}

function notFound(ref: SessionRef): Rejected {
	return rejected("not_found", `no Pi session ${ref.backend}/${ref.sessionId}`);
}
