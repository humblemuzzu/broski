/**
 * `import_session`: a session file arriving from the phone in parts. The parts are held aside; the last one has the
 * whole file judged as Pi reads session files (`transfer/session-check.ts`), and a good file is put in the sessions
 * directory of its project and listed. A bad one is refused with the line that makes it bad, and nothing is kept.
 */

import type { BackendCallResult, ImportSessionOp } from "../../../contract";
import { errorText } from "../error-text";
import { isDirectory } from "../is-directory";
import type { SessionStore } from "../ports";
import { rejected } from "../rejections";
import { isFileSystemError } from "../store/open-file";
import { decodeBase64 } from "../transfer/part-io";
import { checkSessionFile } from "../transfer/session-check";
import type { UploadDesk } from "../transfer/upload-desk";

export interface ImportDeps {
	readonly store: Pick<SessionStore, "importSession">;
	readonly uploads: UploadDesk;
	readonly now: () => number;
}

export async function importSession(deps: ImportDeps, op: ImportSessionOp): Promise<BackendCallResult> {
	const bytes = decodeBase64(op.data);
	if (bytes === undefined) return rejected("invalid_input", "the part is not base64");
	try {
		const held = await deps.uploads.take(op.uploadId, op.offset, bytes);
		if (typeof held !== "number") return held;
		if (!op.last) return { status: "accepted", result: { kind: "import_session", received: held } };
		return await finish(deps, op.uploadId, held);
	} catch (error) {
		if (!isFileSystemError(error)) throw error;
		await deps.uploads.finish(op.uploadId);
		return rejected("backend_error", `the upload could not be kept: ${errorText(error)}`);
	}
}

async function finish(deps: ImportDeps, uploadId: string, received: number): Promise<BackendCallResult> {
	try {
		const path = await deps.uploads.pathOf(uploadId);
		if (path === undefined || received === 0) {
			return rejected("invalid_input", "the file is empty");
		}
		const checked = await checkSessionFile(path, deps.now);
		if ("reason" in checked) return rejected("invalid_input", `this is not a Pi session file: ${checked.reason}`);
		if (!isDirectory(checked.header.cwd)) {
			return rejected(
				"invalid_input",
				`the session's project directory ${checked.header.cwd} is not on this Mac, so it could not run here`,
			);
		}
		const imported = await deps.store.importSession(checked.header, path);
		if ("rejection" in imported) return imported;
		return { status: "accepted", result: { kind: "import_session", received, sessionId: imported.sessionId } };
	} finally {
		await deps.uploads.finish(uploadId);
	}
}
