/** What the store's files share: the injected deps and the caches that live as long as the store. */

import type { Rejected } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import { ActivityTimes } from "./activity";
import type { BuiltChain } from "./chain-reader";
import type { Candidate, Position } from "./enumerate";
import { ForkLinks } from "./fork-links";
import { FullReads } from "./full-reads";
import { FileLocator } from "./locator";
import { ProjectDirs } from "./project-dirs";
import { RankedListings } from "./ranked-listing";
import { TitleSources } from "./title-source";
import { TranscriptIndex } from "./transcript-index";

export interface StoreContext {
	readonly deps: StoreDeps;
	readonly locator: FileLocator;
	readonly index: TranscriptIndex;
	readonly dirs: ProjectDirs;
	readonly forks: ForkLinks;
	readonly reads: FullReads<BuiltChain | Rejected>;
	readonly titles: TitleSources;
	readonly activity: ActivityTimes;
	readonly listings: RankedListings<RankedCandidate>;
}

/** A listed file with where it ranks: `at` is when its conversation last moved. */
export interface RankedCandidate extends Candidate, Position {
	readonly path: string;
}

export function createStoreContext(deps: StoreDeps): StoreContext {
	const { sdk, stateDir } = deps.services;
	const locator = new FileLocator(() => sdk.configRoot());
	return {
		deps,
		locator,
		index: new TranscriptIndex(),
		dirs: new ProjectDirs(),
		forks: new ForkLinks(stateDir),
		reads: new FullReads(),
		titles: new TitleSources(locator),
		activity: new ActivityTimes(),
		listings: new RankedListings(),
	};
}
