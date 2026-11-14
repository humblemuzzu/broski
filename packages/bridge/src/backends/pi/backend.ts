/**
 * The Pi `AgentBackend`: every method delegates to the part that owns it. Reads go to the store with
 * the hosted sessions' live facts laid over them; a hosted session is written only through its host.
 */

import { stat } from "node:fs/promises";
import type { AgentBackend, BackendHost, CommandsListResult, Rejected, SessionRef } from "../../contract";
import { CatalogFeed } from "./catalog-feed";
import { PiCommandLister } from "./commands";
import { ConfigWatch } from "./config-watch";
import { parseChildSessionId } from "./ids";
import { openChildSession } from "./live/child-open";
import { SessionHosts } from "./live/session-hosts";
import { ModelCatalogue } from "./models/catalogue";
import { listPiModes } from "./modes";
import type { SessionStore } from "./ports";
import { rejected } from "./rejections";
import type { PiServices } from "./services";
import { piStatus } from "./status";
import { createSessionStore } from "./store/session-store";
import { TerminalLink, type TerminalLinkOptions } from "./terminal/link";
import { PI_TRAITS } from "./traits";
import { builtinExtensions } from "./ui/extensions";

/** The parts one Pi backend is made of, which `piBackendOf` puts behind the contract. */
export interface PiParts {
	readonly services: PiServices;
	readonly catalog: CatalogFeed;
	readonly store: SessionStore;
	readonly models: ModelCatalogue;
	readonly hosts: SessionHosts;
	readonly commands: PiCommandLister;
	readonly config: ConfigWatch;
	readonly terminal: TerminalLink;
}

export function createPiBackend(host: BackendHost, services: PiServices): AgentBackend {
	return piBackendOf(createPiParts(host, services));
}

export function createPiParts(host: BackendHost, services: PiServices, link?: TerminalLinkOptions): PiParts {
	const { agentDir } = services;
	const catalog = new CatalogFeed(host.catalog);
	const store = createSessionStore({ agentDir, catalog, now: Date.now });
	const models = new ModelCatalogue(services.models, agentDir);
	const shared = {
		agentDir,
		modelRuntime: services.sessionRuntime,
		scope: (patterns: readonly string[]) => services.models.scope(patterns),
	};
	const terminal = new TerminalLink(agentDir, link, {
		now: Date.now,
		busy: (sessionId) => hosts.isBusy(sessionId),
		changed: (sessionId, path) => announce(sessionId, path),
	});
	const hosts: SessionHosts = new SessionHosts({
		terminals: terminal.registry,
		shared,
		models,
		store,
		catalog,
		now: Date.now,
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
	const commands = new PiCommandLister({ agentDir, extensions: builtinExtensions });
	const config = new ConfigWatch(agentDir, catalog, () =>
		piStatus(services.models, agentDir, { proxy: services.proxy, link: terminal }),
	);
	store.watch(hosts);
	config.attach();
	return { services, catalog, store, models, hosts, commands, config, terminal };
}

export function piBackendOf(parts: PiParts): AgentBackend {
	const { services, catalog, store, models, hosts, commands, config, terminal } = parts;
	const listCommands = async (scope: { cwd?: string; session?: SessionRef }): Promise<CommandsListResult> => {
		if (scope.session === undefined) {
			const live = scope.cwd === undefined ? undefined : hosts.sessionIn(scope.cwd);
			return commands.list(live ? { session: live } : { cwd: scope.cwd });
		}
		if (scope.session.backend !== "pi") return notFound(scope.session);
		const live = hosts.session(scope.session.sessionId);
		if (live) return commands.list({ session: live });
		const stored = await store.locate(scope.session.sessionId);
		return "status" in stored ? stored : commands.list({ cwd: stored.cwd });
	};
	return {
		id: "pi",
		traits: PI_TRAITS,
		status: () => {
			config.attach();
			return piStatus(services.models, services.agentDir, { proxy: services.proxy, link: terminal });
		},
		listSessions: (query, page) => store.list(query, page, hosts),
		getSession: async (ref) => (ref.backend === "pi" ? store.get(ref.sessionId, hosts) : notFound(ref)),
		readTranscript: async (ref, page) =>
			ref.backend === "pi" ? store.transcript(ref.sessionId, page, hosts) : notFound(ref),
		readAttachment: async (ref, id) => (ref.backend === "pi" ? store.attachment(ref.sessionId, id) : notFound(ref)),
		listModels: (cwd, options) => models.list(cwd, options),
		listCommands,
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

function notFound(ref: SessionRef): Rejected {
	return rejected("not_found", `no Pi session ${ref.backend}/${ref.sessionId}`);
}
