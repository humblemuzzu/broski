/**
 * The store as the rest of the adapter sees it: `SessionStore` over one index of Pi's session files. A read the file
 * system failed this time (`EMFILE`, `EIO`…; `open-file.ts`) is answered `backend_error`, never thrown.
 */

import type { PageRequest, Rejected, SessionId } from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import { errorText } from "../error-text";
import { parseChildSessionId } from "../ids";
import { itemsOfEntry } from "../mapping/message-items";
import type { LiveOverlay, SessionStore } from "../ports";
import { rejected } from "../rejections";
import { readAttachment } from "./attachments";
import { childTranscript, getChild } from "./children";
import { getSession, listSessions } from "./list";
import { forkStored, type MutationDeps, removeStored, renameStored } from "./mutations";
import { isFileSystemError } from "./open-file";
import { piSessionDirs } from "./session-dir";
import { SessionIndex } from "./session-index";
import { SessionWatch } from "./session-watch";
import { locateStored, storedFacts } from "./stored-session";
import { ToolChildren } from "./tool-children";
import { readTranscript } from "./transcript";

export interface SessionStoreDeps {
	readonly agentDir: string;
	readonly catalog: CatalogFeed;
	readonly now: () => number;
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
	const dirs = piSessionDirs(deps.agentDir);
	const index = new SessionIndex(dirs);
	const toolChildren = new ToolChildren(index);
	const reads: Reads = { index, toolChildren };
	const mutation: MutationDeps = { index, dirs, catalog: deps.catalog, now: deps.now, itemsOf: itemsOfEntry };
	const watcher = new SessionWatch({ index, catalog: deps.catalog, roots: () => dirs.roots() });
	const learn = (cwd: string | undefined): void => {
		const own = cwd === undefined ? undefined : dirs.know(cwd);
		if (own !== undefined) index.adopt(own);
		watcher.attach();
	};
	const reaching = <T>(work: () => Promise<T>): Promise<T | Rejected> => answered(work).finally(() => watcher.attach());
	return {
		list: async (query, page, live) => {
			learn(query.cwd);
			const result = await answered(() => listSessions(index, query, page, live, toolChildren));
			watcher.notify();
			return result;
		},
		get: (sessionId, live) => reaching(() => readSession(reads, sessionId, live)),
		transcript: (sessionId, page, live) => reaching(() => readSessionTranscript(reads, sessionId, page, live)),
		attachment: (sessionId, attachment) => reaching(() => readAttachment(index, sessionId, attachment)),
		locate: (sessionId) => reaching(() => locateStored(index, sessionId)),
		facts: (session) => reaching(() => storedFacts(index, session)),
		sessionDirFor: (cwd) => {
			learn(cwd);
			return dirs.forCwd(cwd);
		},
		rename: (sessionId, name) => reaching(() => renameStored(mutation, sessionId, name)),
		remove: (sessionId, release) => reaching(() => removeStored(mutation, sessionId, release)),
		fork: (sessionId, at, live) => reaching(() => forkStored(mutation, sessionId, at, live)),
		watch: (live) => watcher.start(live),
		dispose: () => watcher.stop(),
	};
}

interface Reads {
	readonly index: SessionIndex;
	readonly toolChildren: ToolChildren;
}

/** A session's row, or a tool call's child session's, as its id says. */
function readSession(reads: Reads, sessionId: SessionId, live: LiveOverlay) {
	const { index, toolChildren } = reads;
	if (parseChildSessionId(sessionId) === undefined) return getSession(index, sessionId, live);
	return getChild({ children: toolChildren, live }, (parentId) => getSession(index, parentId, live), sessionId);
}

function readSessionTranscript(reads: Reads, sessionId: SessionId, page: PageRequest, live: LiveOverlay) {
	const { index, toolChildren } = reads;
	if (parseChildSessionId(sessionId) === undefined) return readTranscript(index, sessionId, page, live, itemsOfEntry);
	const parent = (parentId: SessionId) => getSession(index, parentId, live);
	return childTranscript({ children: toolChildren, live }, parent, sessionId, page);
}

async function answered<T>(work: () => Promise<T>): Promise<T | Rejected> {
	try {
		return await work();
	} catch (error) {
		if (!isFileSystemError(error)) throw error;
		return rejected("backend_error", `Pi's session files could not be read: ${errorText(error)}`);
	}
}
