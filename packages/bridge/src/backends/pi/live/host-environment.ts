import type { PermissionsRecord } from "../broski-entries";
import type { CatalogFeed } from "../catalog-feed";
import type { ModelCatalogue } from "../models/catalogue";
import type { PiLaunch } from "../rpc/child";
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
}

/** The session a host runs, as its `pi` is started on it. */
export interface HostStart {
	readonly cwd: string;
	readonly file: string;
	/** The file's last entry when `pi` opens it. */
	readonly lastEntryId: string | null;
	readonly launch: PiLaunch;
	readonly permissions: PermissionsRecord;
	readonly facts: HostedFacts;
}
