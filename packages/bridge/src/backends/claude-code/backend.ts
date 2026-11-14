/**
 * The Claude Code `AgentBackend`: every method delegates to the part that owns it. Reads go to the store with the
 * hosted sessions' live facts laid over them; a session is opened by the live sessions, its child by its parent's
 * host, and one a terminal is writing by the terminal watch (D21).
 */

import type { AgentBackend, BackendHost, CommandsListResult, SessionRef } from "../../contract";
import { CatalogFeed } from "./catalog-feed";
import { createLiveSessions } from "./live/registry";
import { CLAUDE_CODE_MAPPING } from "./mapping";
import { createCatalogue } from "./models/catalog";
import { type ConfigWatch, createConfigWatch } from "./models/config-watch";
import { notFound, openSession } from "./open-session";
import { createOwnership } from "./owned";
import type { CatalogueAccess, LiveSessions, Ownership, SessionStore, TerminalWatch } from "./ports";
import { isRejected } from "./rejections";
import type { ClaudeCodeServices } from "./services";
import { createSessionStore } from "./store/session-store";
import { createTerminalWatch } from "./terminal/watch-only";
import { CLAUDE_CODE_TRAITS } from "./traits";
import { createAskDesk } from "./ui/desk";

/** The parts one Claude Code backend is made of, which `claudeCodeBackendOf` puts behind the contract. */
export interface ClaudeCodeParts {
	readonly services: ClaudeCodeServices;
	readonly catalog: CatalogFeed;
	readonly ownership: Ownership;
	readonly terminal: TerminalWatch;
	readonly store: SessionStore;
	readonly catalogue: CatalogueAccess;
	readonly live: LiveSessions;
	readonly configWatch: ConfigWatch;
}

export function createClaudeCodeParts(host: BackendHost, services: ClaudeCodeServices): ClaudeCodeParts {
	const catalog = new CatalogFeed(host.catalog);
	const ownership = createOwnership({ services });
	const terminal = createTerminalWatch({
		services,
		catalog,
		mapping: CLAUDE_CODE_MAPPING,
		hosted: (sessionId) => live.isHosted(sessionId),
		ownWriteAt: (sessionId) => ownership.ownWriteAt(sessionId),
		locate: (sessionId) => store.locate(sessionId),
	});
	const store = createSessionStore({ services, catalog, ownership, terminal });
	const catalogue = createCatalogue({ services, catalog });
	const live: LiveSessions = createLiveSessions({
		services,
		catalog,
		store,
		ownership,
		catalogue,
		mapping: CLAUDE_CODE_MAPPING,
		createDesk: createAskDesk,
	});
	const configWatch = createConfigWatch({ configRoot: services.sdk.configRoot(), catalogue });
	return { services, catalog, ownership, terminal, store, catalogue, live, configWatch };
}

export function claudeCodeBackendOf(parts: ClaudeCodeParts): AgentBackend {
	const { services, catalog, terminal, store, catalogue, live, configWatch } = parts;
	return {
		id: "claude-code",
		traits: CLAUDE_CODE_TRAITS,
		status: () => catalogue.status(),
		listSessions: (query, page) => store.list(query, page, live),
		getSession: async (ref) => (mine(ref) ? store.get(ref.sessionId, live) : notFound(ref)),
		readTranscript: async (ref, page) => (mine(ref) ? store.transcript(ref.sessionId, page, live) : notFound(ref)),
		readAttachment: async (ref, id) => (mine(ref) ? store.attachment(ref.sessionId, id) : notFound(ref)),
		listModels: (cwd, options) => catalogue.models(cwd, options),
		listCommands: (scope) => listCommands(parts, scope),
		listModes: (cwd) => catalogue.modes(cwd),
		open: (target, sink) => openSession(parts, target, sink),
		rename: async (ref, title) => (mine(ref) ? store.rename(ref.sessionId, title, live) : notFound(ref)),
		delete: async (ref) => {
			if (!mine(ref)) return notFound(ref);
			await live.end(ref.sessionId);
			return store.remove(ref.sessionId);
		},
		fork: async (ref, at) => (mine(ref) ? store.fork(ref.sessionId, at, live) : notFound(ref)),
		dispose: async () => {
			try {
				configWatch.dispose();
				await terminal.dispose();
				await live.dispose();
				store.dispose();
				await services.sdk.dispose();
			} finally {
				catalog.silence();
			}
		},
	};
}

async function listCommands(
	parts: ClaudeCodeParts,
	scope: { cwd?: string; session?: SessionRef },
): Promise<CommandsListResult> {
	if (scope.session === undefined) return parts.catalogue.commands(scope.cwd);
	if (!mine(scope.session)) return notFound(scope.session);
	const stored = await parts.store.locate(scope.session.sessionId);
	return isRejected(stored) ? stored : parts.catalogue.commands(stored.cwd);
}

function mine(ref: SessionRef): boolean {
	return ref.backend === "claude-code";
}
