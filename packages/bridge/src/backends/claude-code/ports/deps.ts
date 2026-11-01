/** What `backend.ts` hands each lane's entry point: frozen, so every lane builds against the same wiring. */

import type { Rejected, SessionId } from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import type { ClaudeCodeServices } from "../services";
import type { AskDeskFactory } from "./asks";
import type { CatalogueAccess } from "./catalogue";
import type { LiveSessions } from "./live";
import type { MappingPort } from "./mapping";
import type { Ownership, SessionStore, StoredSession } from "./store";
import type { TerminalPresence } from "./terminal";

export interface OwnershipDeps {
	readonly services: ClaudeCodeServices;
}

export interface StoreDeps {
	readonly services: ClaudeCodeServices;
	readonly catalog: CatalogFeed;
	readonly ownership: Ownership;
	readonly terminal: TerminalPresence;
}

export interface CatalogueDeps {
	readonly services: ClaudeCodeServices;
	readonly catalog: CatalogFeed;
}

export interface LiveDeps {
	readonly services: ClaudeCodeServices;
	readonly catalog: CatalogFeed;
	readonly store: SessionStore;
	readonly ownership: Ownership;
	readonly catalogue: CatalogueAccess;
	readonly terminal: TerminalPresence;
	readonly mapping: MappingPort;
	readonly createDesk: AskDeskFactory;
}

export interface OpsDeps {
	readonly services: ClaudeCodeServices;
	readonly catalog: CatalogFeed;
	readonly store: SessionStore;
	readonly live: LiveSessions;
	readonly catalogue: CatalogueAccess;
}

/** The terminal watch is built before the store and the live sessions, so it reaches them through functions. */
export interface TerminalDeps {
	readonly services: ClaudeCodeServices;
	readonly catalog: CatalogFeed;
	readonly mapping: MappingPort;
	readonly hosted: (sessionId: SessionId) => boolean;
	/** When this bridge's host of the session last ended (`Ownership.releasedAt`): a write before it was its own. */
	readonly releasedAt: (sessionId: SessionId) => number | undefined;
	readonly locate: (sessionId: SessionId) => Promise<StoredSession | Rejected>;
}
