/** Lane B · what the mapper remembers between frames; its fields are lane B's to choose. */

import type { MappingSeed } from "../ports/mapping";

export class MapperState {
	readonly ownSends = new Set<string>();

	constructor(readonly seed: MappingSeed) {}
}
