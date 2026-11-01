/** Lane A · the bytes behind an `ImageRef` of the transcript (`ids.ts` `imageAttachmentId`). */

import type { AttachmentId, AttachmentReadResult, SessionId } from "../../../contract";
import type { StoreDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function readImage(
	_deps: StoreDeps,
	_sessionId: SessionId,
	_attachment: AttachmentId,
): Promise<AttachmentReadResult> {
	return notBuilt("lane A: readImage");
}
