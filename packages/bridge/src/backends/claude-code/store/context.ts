/** Lane A · what the store's files share: the injected deps and the caches that live as long as the store. */

import type { StoreDeps } from "../ports/deps";
import type { LiveOverlay } from "../ports/store";
import { ForkLinks } from "./fork-links";
import { FileLocator } from "./locator";
import { ProjectDirs } from "./project-dirs";
import { TranscriptIndex } from "./transcript-index";

const NO_LIVE: LiveOverlay = { row: () => undefined };

export interface StoreContext {
	readonly deps: StoreDeps;
	/** The overlay of the latest call that had one: events a call without one emits (`rename`, `remove`) use it. */
	live: LiveOverlay;
	readonly locator: FileLocator;
	readonly index: TranscriptIndex;
	readonly dirs: ProjectDirs;
	readonly forks: ForkLinks;
}

export function createStoreContext(deps: StoreDeps): StoreContext {
	const { sdk, stateDir } = deps.services;
	return {
		deps,
		live: NO_LIVE,
		locator: new FileLocator(() => sdk.configRoot()),
		index: new TranscriptIndex(),
		dirs: new ProjectDirs(),
		forks: new ForkLinks(stateDir),
	};
}
