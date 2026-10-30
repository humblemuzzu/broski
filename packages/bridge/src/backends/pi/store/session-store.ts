/**
 * The store as the rest of the adapter sees it: `SessionStore` over one index of Pi's session files. A read the file
 * system failed this time (`EMFILE`, `EIO`…; `open-file.ts`) is answered `backend_error`, never thrown.
 */

import type { Rejected, SessionId } from "../../../contract";
import type { CatalogFeed } from "../catalog-feed";
import { errorText } from "../error-text";
import { parseChildSessionId } from "../ids";
import { itemsOfEntry } from "../mapping/message-items";
import type { SessionStore, StoredSession } from "../ports";
import { rejected } from "../rejections";
import { readAttachment } from "./attachments";
import { childTranscript, getChild } from "./children";
import { getSession, listSessions } from "./list";
import { claimStored, forkStored, type MutationDeps, removeStored, renameStored } from "./mutations";
import { isFileSystemError } from "./open-file";
import { piSessionDirs } from "./session-dir";
import { SessionIndex } from "./session-index";
import { SessionWatch } from "./session-watch";
import { ToolChildren } from "./tool-children";
import { entryOfItem, readTranscript } from "./transcript";
import { readTree } from "./tree";

export interface SessionStoreDeps {
	readonly agentDir: string;
	readonly catalog: CatalogFeed;
	readonly now: () => number;
}

export function createSessionStore(deps: SessionStoreDeps): SessionStore {
	const dirs = piSessionDirs(deps.agentDir);
	const index = new SessionIndex(dirs);
	const toolChildren = new ToolChildren(index);
	const mutation: MutationDeps = { index, dirs, catalog: deps.catalog, now: deps.now, itemsOf: itemsOfEntry };
	const watcher = new SessionWatch({ index, catalog: deps.catalog, roots: () => dirs.roots() });
	const learn = (cwd: string | undefined): void => {
		const own = cwd === undefined ? undefined : dirs.know(cwd);
		if (own !== undefined) index.adopt(own);
		watcher.attach();
	};
	const reaching = <T>(work: () => Promise<T>): Promise<T | Rejected> => answered(work).finally(() => watcher.attach());
	const locate = async (sessionId: SessionId): Promise<StoredSession | Rejected> => {
		const head = await index.find(sessionId);
		if (head === undefined) return rejected("not_found", `no Pi session ${sessionId}`);
		const { origin } = await index.complete(head);
		return { sessionId, path: head.path, cwd: head.cwd, origin };
	};
	return {
		list: async (query, page, live) => {
			learn(query.cwd);
			const result = await answered(() => listSessions(index, query, page, live, toolChildren));
			watcher.notify();
			return result;
		},
		get: (sessionId, live) =>
			reaching(() =>
				parseChildSessionId(sessionId) === undefined
					? getSession(index, sessionId, live)
					: getChild({ children: toolChildren, live }, (parentId) => getSession(index, parentId, live), sessionId),
			),
		transcript: (sessionId, page, live) =>
			reaching(() =>
				parseChildSessionId(sessionId) === undefined
					? readTranscript(index, sessionId, page, live, itemsOfEntry)
					: childTranscript(
							{ children: toolChildren, live },
							(parentId) => getSession(index, parentId, live),
							sessionId,
							page,
						),
			),
		tree: (sessionId, page) => reaching(() => readTree(index, sessionId, page)),
		attachment: (sessionId, attachment) => reaching(() => readAttachment(index, sessionId, attachment)),
		locate: (sessionId) => reaching(() => locate(sessionId)),
		sessionDirFor: (cwd) => {
			learn(cwd);
			return dirs.forCwd(cwd);
		},
		entryOf: (sessionId, itemId, live) => reaching(() => entryOfItem(index, sessionId, itemId, live, itemsOfEntry)),
		rename: (sessionId, name) => reaching(() => renameStored(mutation, sessionId, name)),
		claim: (sessionId) => reaching(() => claimStored(mutation, sessionId)),
		remove: (sessionId, release) => reaching(() => removeStored(mutation, sessionId, release)),
		fork: (sessionId, at, live) => reaching(() => forkStored(mutation, sessionId, at, live)),
		watch: (live) => watcher.start(live),
		dispose: () => watcher.stop(),
	};
}

async function answered<T>(work: () => Promise<T>): Promise<T | Rejected> {
	try {
		return await work();
	} catch (error) {
		if (!isFileSystemError(error)) throw error;
		return rejected("backend_error", `Pi's session files could not be read: ${errorText(error)}`);
	}
}
