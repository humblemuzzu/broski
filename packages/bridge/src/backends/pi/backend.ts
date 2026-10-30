/**
 * The Pi `AgentBackend`: every method delegates to the part that owns it. Reads go to the store with
 * the hosted sessions' live facts laid over them; a hosted session is written only through its host.
 */

import type {
	AgentBackend,
	BackendCallResult,
	BackendHost,
	CommandsListResult,
	Rejected,
	SessionRef,
} from "../../contract";
import { CatalogFeed } from "./catalog-feed";
import { PiCommandLister } from "./commands";
import { ConfigWatch } from "./config-watch";
import { SessionHosts } from "./live/session-hosts";
import { ModelCatalogue } from "./models/catalogue";
import { listPiModes } from "./modes";
import { navigateTree } from "./ops/navigate-tree";
import type { SessionStore } from "./ports";
import { rejected } from "./rejections";
import type { PiServices } from "./services";
import { piStatus } from "./status";
import { createSessionStore } from "./store/session-store";
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
}

export function createPiBackend(host: BackendHost, services: PiServices): AgentBackend {
	return piBackendOf(createPiParts(host, services));
}

export function createPiParts(host: BackendHost, services: PiServices): PiParts {
	const { agentDir } = services;
	const catalog = new CatalogFeed(host.catalog);
	const store = createSessionStore({ agentDir, catalog, now: Date.now });
	const models = new ModelCatalogue(services.models, agentDir);
	const shared = {
		agentDir,
		modelRuntime: services.models.runtime,
		scope: (patterns: readonly string[]) => services.models.scope(patterns),
	};
	const hosts = new SessionHosts({ shared, models, store, catalog, now: Date.now });
	const commands = new PiCommandLister({ agentDir, extensions: builtinExtensions });
	const config = new ConfigWatch(agentDir, catalog, () => piStatus(services.models, agentDir));
	store.watch(hosts);
	config.attach();
	return { services, catalog, store, models, hosts, commands, config };
}

export function piBackendOf(parts: PiParts): AgentBackend {
	const { services, catalog, store, models, hosts, commands, config } = parts;
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
			return piStatus(services.models, services.agentDir);
		},
		listSessions: (query, page) => store.list(query, page, hosts),
		getSession: async (ref) => (ref.backend === "pi" ? store.get(ref.sessionId, hosts) : notFound(ref)),
		readTranscript: async (ref, page) =>
			ref.backend === "pi" ? store.transcript(ref.sessionId, page, hosts) : notFound(ref),
		readAttachment: async (ref, id) => (ref.backend === "pi" ? store.attachment(ref.sessionId, id) : notFound(ref)),
		listModels: (cwd) => models.list(cwd),
		listCommands,
		listModes: async () => listPiModes(),
		open: async (target, sink) =>
			target.kind === "existing" && target.session.backend !== "pi"
				? notFound(target.session)
				: hosts.open(target, sink),
		rename: async (ref, title) =>
			ref.backend === "pi"
				? hosts.rename(ref.sessionId, title, (name) => store.rename(ref.sessionId, name))
				: notFound(ref),
		delete: async (ref) =>
			ref.backend === "pi"
				? hosts.remove(ref.sessionId, (release) => store.remove(ref.sessionId, release))
				: notFound(ref),
		fork: async (ref, at) => (ref.backend === "pi" ? store.fork(ref.sessionId, at, hosts) : notFound(ref)),
		call: async (call): Promise<BackendCallResult> =>
			call.backend === "pi"
				? navigateTree({ hosts, store, live: hosts, catalog }, call.op)
				: rejected("unsupported", `Pi has no ${call.backend} op ${call.op.kind}`),
		dispose: async () => {
			store.dispose();
			config.stop();
			await hosts.dispose();
			catalog.silence();
		},
	};
}

function notFound(ref: SessionRef): Rejected {
	return rejected("not_found", `no Pi session ${ref.backend}/${ref.sessionId}`);
}
