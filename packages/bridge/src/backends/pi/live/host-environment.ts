import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { PermissionsRecord } from "../broski-entries";
import type { CatalogFeed } from "../catalog-feed";
import type { ModelCatalogue } from "../models/catalogue";
import type { HostedFacts } from "./host-summary";
import type { NoticeMemory } from "./notice-memory";
import type { SharedServices } from "./runtime-factory";
import type { SessionHost } from "./session-host";
import type { SessionLocks } from "./session-lock";

/** What every host shares: the process's services, and how the registry hears of a host's needs. */
export interface HostEnvironment {
	readonly shared: SharedServices;
	readonly models: Pick<ModelCatalogue, "find">;
	readonly catalog: CatalogFeed;
	readonly locks: SessionLocks;
	readonly notices: NoticeMemory;
	readonly now: () => number;
	/** The host is unattached and idle: it may end, under the session lock. */
	readonly idle: (host: SessionHost) => void;
	/** The host has ended. */
	readonly forget: (host: SessionHost) => void;
}

/** The session a host runs: a new one, or an existing one opened by the registry. */
export interface HostStart {
	readonly cwd: string;
	readonly sessionManager: SessionManager;
	readonly model?: Model<Api>;
	readonly thinkingLevel?: ThinkingLevel;
	readonly permissions: PermissionsRecord;
	readonly facts: HostedFacts;
}
