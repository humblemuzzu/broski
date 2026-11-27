/**
 * The adapter's own index of session files: one record per file path, recomputed only when the file's
 * stamp changes, so a listing costs a `readdir` and a `stat` per file plus the head and tail of what changed.
 * It lives in memory and is as large as the session directories; nothing is persisted.
 */

import { dirname, resolve } from "node:path";
import { rejected } from "../../../adapter-kit/rejections";
import type { Rejected, SessionId } from "../../../contract";
import { filesNowIn, jsonlFilesIn, type ListedFile, statFiles, statStamp } from "./dir-listing";
import { type FileStamp, type SessionFileIndex, sameStamp } from "./jsonl-reader";
import { mapPool } from "./pool";
import { readSessionDetails, type SessionDetails } from "./session-details";
import { canonicalCwd, type SessionDirs } from "./session-dir";
import { readSessionHead, type SessionHead } from "./session-head";
import { SpanCache } from "./span-cache";

/** A listing row's facts: the head of the file, then its title and origin. */
export type IndexedSession = SessionHead & Pick<SessionDetails, "name" | "firstPrompt" | "origin">;

/** What happened to the session files since the news was last taken. */
export interface SessionChanges {
	readonly updated: SessionHead[];
	readonly removed: SessionId[];
}

type PathNews = { readonly updated: SessionHead } | { readonly removed: SessionId };

interface FileRecord {
	readonly stamp: FileStamp;
	/** Undefined: only the stamp is known. Null: the file is not a Pi session. */
	readonly head: SessionHead | null | undefined;
	details: SessionDetails | undefined;
}

const READ_CONCURRENCY = 8;
/** An id no file holds is looked for again only after this, or once the index has learned of a new session. */
const MISS_TTL_MS = 5_000;
const REMEMBERED_MISSES = 256;

export class SessionIndex {
	private readonly records = new Map<string, FileRecord>();
	private readonly pathOf = new Map<SessionId, string>();
	private readonly reading = new Map<
		string,
		{ readonly stamp: FileStamp; readonly work: Promise<SessionHead | undefined> }
	>();
	private readonly spans = new SpanCache();
	private readonly misses = new Map<SessionId, { readonly generation: number; readonly at: number }>();
	private generation = 0;
	private watching = false;
	private readonly news = new Map<string, PathNews>();

	constructor(private readonly dirs: SessionDirs) {}

	/** The heads of every session file under the directories of `cwd` whose header cwd is `cwd`, one per session id. */
	async scan(cwd: string | undefined): Promise<SessionHead[]> {
		const dirs = this.dirs.toScan(cwd);
		const files = await statFiles(await jsonlFilesIn(dirs));
		this.prune(new Set(dirs), files);
		const heads = await mapPool(files, READ_CONCURRENCY, (file) => this.headOf(file.path, file.stamp));
		const wanted = cwd === undefined ? undefined : canonicalCwd(cwd);
		const canonical = new Map<string, string>();
		const rows = new Map<SessionId, SessionHead>();
		for (const head of heads) {
			if (head === undefined || !inCwd(head.cwd, wanted, canonical)) continue;
			const known = rows.get(head.sessionId);
			if (known === undefined || isNewer(head, known)) rows.set(head.sessionId, head);
		}
		return [...rows.values()];
	}

	/**
	 * The file of `sessionId`: the known path first, else a header scan of every session directory, and
	 * then of the own directories of the projects the scanned sessions name, which are looked for once.
	 */
	async find(sessionId: SessionId): Promise<SessionHead | undefined> {
		const known = this.pathOf.get(sessionId);
		if (known !== undefined) {
			const head = await this.headAt(known);
			if (head?.sessionId === sessionId) return head;
		}
		if (this.missedLately(sessionId)) return undefined;
		await this.scan(undefined);
		if (!this.pathOf.has(sessionId) && this.learnProjects()) await this.scan(undefined);
		const path = this.pathOf.get(sessionId);
		const head = path === undefined ? undefined : (this.records.get(path)?.head ?? undefined);
		if (head === undefined) this.noteMiss(sessionId);
		return head;
	}

	/** Takes `dir`, a root the store has just learned of, into the index without making what is in it news. */
	adopt(dir: string): void {
		this.generation += 1;
		if (this.watching) this.baseline([dir]);
	}

	/** The head of the file at `path` as it is now. */
	async headAt(path: string): Promise<SessionHead | undefined> {
		const stamp = await statStamp(path);
		if (stamp === undefined) {
			this.drop(path);
			return undefined;
		}
		return this.headOf(path, stamp);
	}

	async complete(head: SessionHead): Promise<IndexedSession> {
		const record = this.records.get(head.path);
		const cached = record?.details;
		if (record !== undefined && cached !== undefined && sameStamp(cached.stamp, record.stamp)) {
			return merge(head, cached);
		}
		const details = await readSessionDetails(head.path, cached);
		if (details === undefined) return merge(head, { name: undefined, firstPrompt: undefined, origin: "external" });
		const current = this.records.get(head.path);
		if (current !== undefined) current.details = details;
		return merge(head, details);
	}

	/**
	 * The session id of the file at `path`: a fork names its parent by path (`parentSession`, pi-coding-agent
	 * `src/core/session-manager.ts:1681`). A path that is not a regular file is not opened: a named pipe would block.
	 */
	async idOfPath(path: string): Promise<SessionId | undefined> {
		const key = resolve(path);
		const known = this.records.get(key)?.head;
		if (known) return known.sessionId;
		return (await statStamp(key)) === undefined ? undefined : (await readSessionHead(key))?.sessionId;
	}

	/** The span index of the file at `path`, rebuilt when its stamp changed. */
	fileIndex(path: string): Promise<SessionFileIndex | "too_large" | undefined> {
		return this.spans.fileIndex(path);
	}

	/** The directories a listing of every cwd reads. */
	directories(): string[] {
		return this.dirs.toScan(undefined);
	}

	/**
	 * From now on a file that appears, changes or goes, however the index learns of it (a listing, a re-scan),
	 * is news for `takeNews`. The files there at the first call are the starting point, and are not news; a later
	 * call changes nothing, so a file that appeared since is news whenever it is found.
	 */
	beginNews(): void {
		if (this.watching) return;
		this.watching = true;
		this.baseline(this.dirs.toScan(undefined));
	}

	/** Brings the records of `dir` up to date; what changed is news. */
	async refresh(dir: string): Promise<void> {
		const files = await statFiles(await jsonlFilesIn([dir]));
		this.prune(new Set([dir]), files);
		const changed = files.filter((file) => {
			const record = this.records.get(file.path);
			return record === undefined || !sameStamp(record.stamp, file.stamp);
		});
		await mapPool(changed, READ_CONCURRENCY, (file) => this.headOf(file.path, file.stamp));
	}

	/** The news since the last call. A session that moved to another file is updated, not removed. */
	takeNews(): SessionChanges {
		const updated: SessionHead[] = [];
		const removed: SessionId[] = [];
		for (const news of this.news.values()) {
			if ("updated" in news) updated.push(news.updated);
			else removed.push(news.removed);
		}
		this.news.clear();
		const stillThere = new Set(updated.map((head) => head.sessionId));
		return { updated, removed: removed.filter((sessionId) => !stillThere.has(sessionId)) };
	}

	/** `head` is news again: announcing it failed. */
	requeue(head: SessionHead): void {
		if (this.watching && !this.news.has(head.path)) this.news.set(head.path, { updated: head });
	}

	forget(path: string): void {
		const head = this.records.get(path)?.head;
		this.records.delete(path);
		this.spans.forget(path);
		if (head && this.pathOf.get(head.sessionId) === path) this.pathOf.delete(head.sessionId);
	}

	private baseline(dirs: readonly string[]): void {
		for (const dir of dirs) {
			for (const { path, stamp } of filesNowIn(dir)) {
				if (!this.records.has(path)) this.records.set(path, { stamp, head: undefined, details: undefined });
			}
		}
	}

	private missedLately(sessionId: SessionId): boolean {
		const miss = this.misses.get(sessionId);
		return miss !== undefined && miss.generation === this.generation && Date.now() - miss.at < MISS_TTL_MS;
	}

	private noteMiss(sessionId: SessionId): void {
		this.misses.delete(sessionId);
		this.misses.set(sessionId, { generation: this.generation, at: Date.now() });
		for (const oldest of this.misses.keys()) {
			if (this.misses.size <= REMEMBERED_MISSES) break;
			this.misses.delete(oldest);
		}
	}

	/** Asks for the own directory of every cwd the known sessions name; true when one was new. */
	private learnProjects(): boolean {
		const cwds = new Set<string>();
		for (const record of this.records.values()) if (record.head?.cwd !== undefined) cwds.add(record.head.cwd);
		let learned = false;
		for (const cwd of cwds) {
			const dir = this.dirs.know(cwd);
			if (dir === undefined) continue;
			this.adopt(dir);
			learned = true;
		}
		return learned;
	}

	/** `forget` for a file that went without this index's doing: news when its session was known. */
	private drop(path: string): void {
		const head = this.records.get(path)?.head;
		if (this.watching && head) this.news.set(path, { removed: head.sessionId });
		this.forget(path);
	}

	/** A read in flight is shared only with a caller that saw the same stamp; a newer stamp reads again. */
	private headOf(path: string, stamp: FileStamp): Promise<SessionHead | undefined> {
		const record = this.records.get(path);
		if (record !== undefined && record.head !== undefined && sameStamp(record.stamp, stamp)) {
			return Promise.resolve(record.head ?? undefined);
		}
		const running = this.reading.get(path);
		if (running !== undefined && sameStamp(running.stamp, stamp)) return running.work;
		const work = this.readHead(path);
		const entry = { stamp, work };
		this.reading.set(path, entry);
		const done = () => {
			if (this.reading.get(path) === entry) this.reading.delete(path);
		};
		work.then(done, done);
		return work;
	}

	private async readHead(path: string): Promise<SessionHead | undefined> {
		const head = await readSessionHead(path);
		if (head !== undefined) {
			this.remember(path, head.stamp, head);
			return head;
		}
		const stamp = await statStamp(path);
		if (stamp === undefined) this.drop(path);
		else this.remember(path, stamp, null);
		return undefined;
	}

	private remember(path: string, stamp: FileStamp, head: SessionHead | null): void {
		const previous = this.records.get(path);
		const before = previous?.head;
		if (before && before.sessionId !== head?.sessionId && this.pathOf.get(before.sessionId) === path) {
			this.pathOf.delete(before.sessionId);
		}
		const unchanged = previous !== undefined && sameStamp(previous.stamp, stamp);
		this.records.set(path, { stamp, head, details: previous?.details });
		if (head && !this.pathOf.has(head.sessionId)) this.generation += 1;
		if (head) this.pathOf.set(head.sessionId, path);
		if (this.watching && head && !unchanged) this.news.set(path, { updated: head });
	}

	/** Files that left the directories just listed leave the index too, so it never outgrows the directories. */
	private prune(dirs: ReadonlySet<string>, files: readonly ListedFile[]): void {
		const present = new Set(files.map((file) => file.path));
		for (const path of [...this.records.keys()]) {
			if (dirs.has(dirname(path)) && !present.has(path)) this.drop(path);
		}
	}
}

/** The span index of the file at `path`, or the refusal to answer a read with. */
export async function openFileIndex(index: SessionIndex, path: string): Promise<SessionFileIndex | Rejected> {
	const file = await index.fileIndex(path);
	if (file === undefined) return rejected("not_found", "the session file is gone or is no longer a Pi session");
	if (file === "too_large") return rejected("backend_error", "the session file is too large to read");
	return file;
}

export function isRejection(value: SessionFileIndex | Rejected): value is Rejected {
	return "rejection" in value;
}

function merge(head: SessionHead, details: Pick<SessionDetails, "name" | "firstPrompt" | "origin">): IndexedSession {
	return { ...head, name: details.name, firstPrompt: details.firstPrompt, origin: details.origin };
}

function isNewer(candidate: SessionHead, known: SessionHead): boolean {
	return candidate.updatedAt !== known.updatedAt ? candidate.updatedAt > known.updatedAt : candidate.path > known.path;
}

function inCwd(cwd: string | undefined, wanted: string | undefined, canonical: Map<string, string>): boolean {
	if (wanted === undefined) return true;
	if (cwd === undefined) return false;
	let resolved = canonical.get(cwd);
	if (resolved === undefined) {
		resolved = canonicalCwd(cwd);
		canonical.set(cwd, resolved);
	}
	return resolved === wanted;
}
