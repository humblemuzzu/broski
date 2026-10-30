/**
 * A new session's file, written when the session is created. Pi writes a new session's file only with its first user
 * or assistant message (`_persist`, pi-coding-agent `src/core/session-manager.ts:1172-1190`), so a session nobody
 * prompted would leave no trace once its host ended, and its id would answer `not_found` (contract README §4: the id
 * is stable for the session's life). Pi creates that file with `openSync(path, "wx")`: had anyone else created it
 * first, its first append would throw `EEXIST`. So the file is written here exactly as that first flush writes it
 * (the header and the entries so far, one line each, `"wx"`), and the session is opened from it with
 * `SessionManager.open`, which loads an existing file as already flushed (`_setSessionFile`, `:1029-1050`): Pi appends
 * to it from then on, as to any session resumed in the terminal.
 */

import { open } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ORIGIN_ENTRY, PERMISSIONS_ENTRY, permissionsEntryData } from "../broski-entries";
import type { PermissionsMode } from "../modes";

export async function createSessionFile(
	cwd: string,
	sessionDir: string,
	permissions: PermissionsMode,
): Promise<SessionManager> {
	const draft = SessionManager.create(cwd, sessionDir);
	draft.appendCustomEntry(ORIGIN_ENTRY);
	if (permissions !== "off") draft.appendCustomEntry(PERMISSIONS_ENTRY, permissionsEntryData(permissions, []));
	const path = draft.getSessionFile();
	const header = draft.getHeader();
	if (path === undefined || header === null) throw new Error("Pi gave the new session no file");
	const lines = [header, ...draft.getEntries()].map((entry) => `${JSON.stringify(entry)}\n`).join("");
	const file = await open(path, "wx");
	try {
		await file.writeFile(lines);
	} finally {
		await file.close();
	}
	return SessionManager.open(path, sessionDir);
}
