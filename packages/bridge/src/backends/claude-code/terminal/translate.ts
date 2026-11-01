/** Lane G · transcript lines as live events of a watch-only session (research 04 §7, rec. 4). */

import type { MappedEvent } from "../ports/mapping";

export class LineTranslator {
	translate(_line: unknown): MappedEvent[] {
		return [];
	}
}
