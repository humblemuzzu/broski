/** Lane A · a newest-first transcript page (D18), ending before an active run (`LiveRow.cut`). */

import type { PageRequest, SessionId, TranscriptReadResult } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import type { LiveOverlay } from "../ports/store";
import { notBuilt } from "../rejections";

export async function transcriptPage(
	_deps: StoreDeps,
	_sessionId: SessionId,
	_page: PageRequest,
	_live: LiveOverlay,
): Promise<TranscriptReadResult> {
	return notBuilt("lane A: transcriptPage");
}
