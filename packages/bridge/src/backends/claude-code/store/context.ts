/** Lane A · what the store's files share: the injected deps and the caches that live as long as the store. */

import type { Rejected } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import type { LiveOverlay } from "../ports/store";
import type { BuiltChain } from "./chain-reader";
import { ForkLinks } from "./fork-links";
import { FullReads } from "./full-reads";
import { FileLocator } from "./locator";
import { ProjectDirs } from "./project-dirs";
import { TranscriptIndex } from "./transcript-index";

export interface StoreContext {
	readonly deps: StoreDeps;
	readonly locator: FileLocator;
	readonly index: TranscriptIndex;
	readonly dirs: ProjectDirs;
	readonly forks: ForkLinks;
	readonly reads: FullReads<BuiltChain | Rejected>;
}

export function createStoreContext(deps: StoreDeps): StoreContext {
	const { sdk, stateDir } = deps.services;
	return {
		deps,
		locator: new FileLocator(() => sdk.configRoot()),
		index: new TranscriptIndex(),
		dirs: new ProjectDirs(),
		forks: new ForkLinks(stateDir),
		reads: new FullReads(),
	};
}
