/**
 * The Claude Code `AgentBackend`: every method delegates to the part that owns it. Reads go to the store with the
 * hosted sessions' live facts laid over them; a session is opened by the live sessions, its child by its parent's
 * host, and one a terminal is writing by the terminal watch (D28).
 */

import { imageRead } from "../../adapter-kit/image-read";
import { isRejected } from "../../adapter-kit/rejections";
import type { AgentBackend, BackendHost, CommandsListResult, SessionRef } from "../../contract";
import { CatalogFeed } from "./catalog-feed";
import { LiveImageCache } from "./live/image-cache";
import { createLiveSessions } from "./live/registry";
import { CLAUDE_CODE_MAPPING } from "./mapping";
import { createCatalogue } from "./models/catalog";
import { type ConfigWatch, createConfigWatch } from "./models/config-watch";
import { notFound, openSession } from "./open-session";
import { createOwnership } from "./owned";
import type { CatalogueAccess, LiveOverlay, LiveSessions, Ownership, SessionStore, TerminalWatch } from "./ports";
import type { ClaudeCodeServices } from "./services";
import { createSessionStore } from "./store/session-store";
import { createTerminalWatch } from "./terminal/watch-only";
import { CLAUDE_CODE_META, CLAUDE_CODE_TRAITS } from "./traits";
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
	readonly images: LiveImageCache;
	/** What the store lays over a session's row: the hosted session's facts, else a terminal process's status. */
	readonly overlay: LiveOverlay;
}

export function createClaudeCodeParts(host: BackendHost, services: ClaudeCodeServices): ClaudeCodeParts {
	const catalog = new CatalogFeed(host.catalog);
	const images = new LiveImageCache();
	const ownership = createOwnership({ services });
	const terminal = createTerminalWatch({
		services,
		catalog,
		mapping: CLAUDE_CODE_MAPPING,
		hosted: (sessionId) => live.isHosted(sessionId),
		ownWriteAt: (sessionId) => ownership.ownWriteAt(sessionId),
		locate: (sessionId) => store.locate(sessionId),
		announce: (sessionId) => void store.announce(sessionId, overlay),
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
		images,
	});
	const configWatch = createConfigWatch({ configRoot: services.sdk.configRoot(), catalogue });
	const overlay: LiveOverlay = { row: (sessionId) => live.row(sessionId) ?? terminal.row(sessionId) };
	return { services, catalog, ownership, terminal, store, catalogue, live, configWatch, images, overlay };
}

export function claudeCodeBackendOf(parts: ClaudeCodeParts): AgentBackend {
	const { services, catalog, terminal, store, catalogue, live, configWatch, images, overlay } = parts;
	return {
		id: "claude-code",
		meta: CLAUDE_CODE_META,
		traits: CLAUDE_CODE_TRAITS,
		status: () => catalogue.status(),
		listSessions: (query, page) => store.list(query, page, overlay),
		getSession: (ref) => getSession(parts, ref),
		readTranscript: async (ref, page) => (mine(ref) ? store.transcript(ref.sessionId, page, overlay) : notFound(ref)),
		readAttachment: async (ref, id, variant) => {
			if (!mine(ref)) return notFound(ref);
			const cached = images.get(ref.sessionId, id);
			if (cached !== undefined) {
				return imageRead(cached, variant ?? "full", services.fitImage, cached.name);
			}
			return store.attachment(ref.sessionId, id, variant);
		},
		listModels: (cwd, options) => catalogue.models(cwd, options),
		listCommands: (scope) => listCommands(parts, scope),
		listModes: (cwd) => catalogue.modes(cwd),
		open: (target, sink) => openSession(parts, target, sink),
		rename: async (ref, title) => (mine(ref) ? store.rename(ref.sessionId, title, overlay) : notFound(ref)),
		delete: async (ref) => {
			if (!mine(ref)) return notFound(ref);
			await live.end(ref.sessionId);
			return store.remove(ref.sessionId);
		},
		fork: async (ref, at) => (mine(ref) ? store.fork(ref.sessionId, at, overlay) : notFound(ref)),
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

async function getSession(parts: ClaudeCodeParts, ref: SessionRef) {
	if (!mine(ref)) return notFound(ref);
	const found = await parts.store.get(ref.sessionId, parts.overlay);
	if (found.status === "accepted") return found;
	const live = parts.live.summary(ref.sessionId);
	return live !== undefined ? { status: "accepted" as const, summary: live } : found;
}

async function listCommands(
	parts: ClaudeCodeParts,
	scope: { cwd?: string; session?: SessionRef },
): Promise<CommandsListResult> {
	if (scope.session === undefined) return parts.catalogue.commands(scope.cwd);
	if (!mine(scope.session)) return notFound(scope.session);
	const liveCwd = parts.live.cwdOf(scope.session.sessionId);
	if (liveCwd !== undefined) return parts.catalogue.commands(liveCwd);
	const stored = await parts.store.locate(scope.session.sessionId);
	return isRejected(stored) ? stored : parts.catalogue.commands(stored.cwd);
}

function mine(ref: SessionRef): boolean {
	return ref.backend === "claude-code";
}
