/** What `backend.ts` hands each lane's entry point: frozen, so every lane builds against the same wiring. */

import type { Rejected, SessionId } from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import type { ClaudeCodeServices } from "../services";
import type { AskDeskFactory } from "./asks";
import type { CatalogueAccess } from "./catalogue";
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
	readonly mapping: MappingPort;
	readonly createDesk: AskDeskFactory;
}

/** The terminal watch is built before the store and the live sessions, so it reaches them through functions. */
export interface TerminalDeps {
	readonly services: ClaudeCodeServices;
	readonly catalog: CatalogFeed;
	readonly mapping: MappingPort;
	readonly hosted: (sessionId: SessionId) => boolean;
	/** Until when the session file's writes were this bridge's own (`Ownership.ownWriteAt`, D25). */
	readonly ownWriteAt: (sessionId: SessionId) => number | undefined;
	readonly locate: (sessionId: SessionId) => Promise<StoredSession | Rejected>;
	/** A terminal session's row changed (its process came, went, or changed status): the list is told. */
	readonly announce: (sessionId: SessionId) => void;
}
