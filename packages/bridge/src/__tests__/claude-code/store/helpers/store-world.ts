/**
 * A store over a temp config dir with the real SDK (a worker under that dir, D36), a temp `HOME` (so the trash stays
 * in the temp tree) and a recording catalog. Nothing here reaches the real `~/.claude` or the real trash.
 */

import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { CatalogFeed } from "../../../../backends/claude-code/catalog-feed";
import { createOwnership } from "../../../../backends/claude-code/owned";
import type { ClaudeSdk, LiveOverlay, LiveRow, Ownership, SessionStore } from "../../../../backends/claude-code/ports";
import { createClaudeSdk } from "../../../../backends/claude-code/sdk/claude-sdk";
import { createClaudeCodeServices } from "../../../../backends/claude-code/services";
import { createSessionStore } from "../../../../backends/claude-code/store/session-store";
import type { CatalogEvent, SessionId } from "../../../../contract";
import { type ClaudeHome, createClaudeHome } from "../../../helpers/claude-home";

export interface SdkCalls {
	getSessionInfo: number;
	getSessionMessages: number;
	getSubagentMessages: number;
	listSessions: number;
	listSubagents: number;
	forkSession: number;
}

export class FakeLive implements LiveOverlay {
	readonly rows = new Map<SessionId, LiveRow>();
	row(sessionId: SessionId): LiveRow | undefined {
		return this.rows.get(sessionId);
	}
}

export interface StoreWorld {
	readonly home: ClaudeHome;
	readonly store: SessionStore;
	readonly ownership: Ownership;
	readonly sdk: ClaudeSdk;
	readonly calls: SdkCalls;
	readonly events: CatalogEvent[];
	readonly live: FakeLive;
	readonly stateDir: string;
	/** A project directory under the temp root, canonical like the cwd the core hands the adapter. */
	project(name: string): string;
	/** Reopens the store and the journal over the same files, as a bridge restart does. */
	restart(): Promise<void>;
	dispose(): Promise<void>;
}

function counting(sdk: ClaudeSdk, calls: SdkCalls): ClaudeSdk {
	const count =
		<A extends unknown[], R>(key: keyof SdkCalls, fn: (...args: A) => R) =>
		(...args: A): R => {
			calls[key] += 1;
			return fn(...args);
		};
	return {
		...sdk,
		getSessionInfo: count("getSessionInfo", sdk.getSessionInfo),
		getSessionMessages: count("getSessionMessages", sdk.getSessionMessages),
		getSubagentMessages: count("getSubagentMessages", sdk.getSubagentMessages),
		listSessions: count("listSessions", sdk.listSessions),
		listSubagents: count("listSubagents", sdk.listSubagents),
		forkSession: count("forkSession", sdk.forkSession),
	};
}

export async function createStoreWorld(): Promise<StoreWorld> {
	const home = createClaudeHome({ git: false });
	const stateDir = join(home.root, "broski-state");
	const env = {
		HOME: home.homeDir,
		XDG_DATA_HOME: join(home.homeDir, ".local", "share"),
	};
	const calls: SdkCalls = {
		getSessionInfo: 0,
		getSessionMessages: 0,
		getSubagentMessages: 0,
		listSessions: 0,
		listSubagents: 0,
		forkSession: 0,
	};
	const real = createClaudeSdk({ configDir: home.configDir, env });
	const sdk = counting(real, calls);
	const events: CatalogEvent[] = [];
	const live = new FakeLive();
	const build = async () => {
		const services = createClaudeCodeServices({
			cli: { found: false, reason: "the store never starts a CLI" },
			configDir: home.configDir,
			env,
			stateDir,
			clientApp: "broski/store-test",
			sdk,
		});
		const ownership = createOwnership({ services });
		await ownership.load();
		const catalog = new CatalogFeed({ emit: (event) => events.push(event) });
		const store = createSessionStore({
			services,
			catalog,
			ownership,
			terminal: { writing: async () => false },
		});
		return { store, ownership };
	};
	let current = await build();
	return {
		home,
		get store() {
			return current.store;
		},
		get ownership() {
			return current.ownership;
		},
		sdk,
		calls,
		events,
		live,
		stateDir,
		project: (name) => {
			const dir = join(home.root, "projects", name);
			mkdirSync(dir, { recursive: true });
			return realpathSync(dir);
		},
		restart: async () => {
			current.store.dispose();
			current = await build();
		},
		dispose: async () => {
			current.store.dispose();
			await real.dispose();
			home.cleanup();
		},
	};
}
