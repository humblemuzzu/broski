/** Size and entry count of the Pi session index file, for the bench scenarios that report them. */

import { stat } from "node:fs/promises";
import { indexCacheFilePath } from "../../src/index-cache/index-cache-root";
import { readIndexCacheLines } from "../../src/index-cache/index-cache-store";
import {
	PI_SESSION_INDEX_FILE,
	PI_SESSION_INDEX_MAX_BYTES,
	PI_SESSION_INDEX_SCHEMA,
	parsePiSessionIndexRecord,
} from "../../src/index-cache/pi-session-index-record";

export async function indexBytes(): Promise<number> {
	const info = await stat(indexCacheFilePath(PI_SESSION_INDEX_FILE)).catch(() => null);
	return info?.size ?? 0;
}

export async function indexEntries(): Promise<number> {
	return (
		await readIndexCacheLines(
			{
				path: indexCacheFilePath(PI_SESSION_INDEX_FILE),
				schema: PI_SESSION_INDEX_SCHEMA,
				maxBytes: PI_SESSION_INDEX_MAX_BYTES,
			},
			parsePiSessionIndexRecord,
		)
	).length;
}
