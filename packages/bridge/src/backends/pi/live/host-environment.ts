import type { PermissionsRecord, PromptRecord } from "../broski-entries";
import type { CatalogFeed } from "../catalog-feed";
import type { ModelCatalogue } from "../models/catalogue";
import type { PiEntry } from "../rpc/replies";
import type { OpenTransport } from "../rpc/transport";
import type { HostedFacts } from "./host-summary";
import type { SessionHost } from "./session-host";
import type { SessionLocks } from "./session-lock";

/** What every host shares, and how the registry hears of a host's needs. */
export interface HostEnvironment {
	readonly models: Pick<ModelCatalogue, "find" | "missing">;
	readonly catalog: CatalogFeed;
	readonly locks: SessionLocks;
	readonly now: () => number;
	/** The host is unattached and idle: it may end, under the session lock. */
	readonly idle: (host: SessionHost) => void;
	/** The host has ended, asked to or not. */
	readonly forget: (host: SessionHost) => void;
	/** The host lost its `pi` to nobody: its holder may still be there to take over again. */
	readonly lost: (host: SessionHost) => void;
	/** An event changed the ready host's session: whether it is busy, and whether a terminal waiting for it may take it. */
	readonly changed: (host: SessionHost) => void;
}

/** A `pi` this bridge takes over from its holder, which replays what it said since the session was last at rest. */
export interface Adoption {
	/** The file's entries since its last user message, which the replayed messages are stored as. */
	readonly seed: readonly PiEntry[];
	readonly prompts: (entryId: string) => PromptRecord | undefined;
	/** The replay lost the start of the run under way. */
	readonly truncated: boolean;
	/** The `pi` runs another version of the bridge's extension, so the host ends once it is idle. */
	readonly retiring: boolean;
	/** Wall-clock epoch ms when the holder's active run started, if one was under way. */
	readonly runStartedAt?: number;
}

/** The session a host runs, as its `pi` is started on it. */
export interface HostStart {
	readonly cwd: string;
	readonly file: string;
	/** The file's last entry when `pi` opens it. */
	readonly lastEntryId: string | null;
	readonly transport: OpenTransport;
	readonly permissions: PermissionsRecord;
	readonly facts: HostedFacts;
	readonly adoption?: Adoption;
}
