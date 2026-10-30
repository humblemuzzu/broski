/**
 * The span indexes of the session files read most recently, rebuilt when a file's stamp changes. A build in flight
 * is shared only with a caller that saw the same stamp: one that saw the file grow since gets a build of its own,
 * or it would read an index that ends before the lines it was asked for.
 */

import { statStamp } from "./dir-listing";
import {
	type FileStamp,
	indexSessionFile,
	MAX_INDEXED_ENTRIES,
	type SessionFileIndex,
	sameStamp,
} from "./jsonl-reader";

type Built = SessionFileIndex | "too_large" | undefined;

/** A larger file is refused before it is scanned; `MAX_INDEXED_ENTRIES` bounds the smaller ones by their lines. */
const MAX_INDEXED_FILE_BYTES = 512 * 1024 ** 2;
const MAX_CACHED_FILES = 3;

export class SpanCache {
	private readonly files = new Map<string, SessionFileIndex>();
	private readonly builds = new Map<string, { readonly stamp: FileStamp; readonly work: Promise<Built> }>();

	/** The span index of the file at `path` as it is now at the latest. */
	async fileIndex(path: string): Promise<Built> {
		const stamp = await statStamp(path);
		if (stamp === undefined) {
			this.files.delete(path);
			return undefined;
		}
		if (stamp.size > MAX_INDEXED_FILE_BYTES) return "too_large";
		const cached = this.files.get(path);
		if (cached !== undefined && sameStamp(cached.stamp, stamp)) {
			this.keep(path, cached);
			return cached;
		}
		const built = await this.build(path, stamp);
		if (built === undefined || built === "too_large") this.files.delete(path);
		else this.keep(path, built);
		return built;
	}

	forget(path: string): void {
		this.files.delete(path);
	}

	private build(path: string, stamp: FileStamp): Promise<Built> {
		const running = this.builds.get(path);
		if (running !== undefined && sameStamp(running.stamp, stamp)) return running.work;
		const work = indexSessionFile(path);
		const entry = { stamp, work };
		this.builds.set(path, entry);
		const done = () => {
			if (this.builds.get(path) === entry) this.builds.delete(path);
		};
		work.then(done, done);
		return work;
	}

	/** Newest last; the oldest go while more than `MAX_CACHED_FILES` files or `MAX_INDEXED_ENTRIES` spans are held. */
	private keep(path: string, file: SessionFileIndex): void {
		this.files.delete(path);
		this.files.set(path, file);
		let spans = 0;
		for (const held of this.files.values()) spans += held.entries.length;
		for (const [oldest, held] of this.files) {
			if (this.files.size <= 1 || (this.files.size <= MAX_CACHED_FILES && spans <= MAX_INDEXED_ENTRIES)) break;
			this.files.delete(oldest);
			spans -= held.entries.length;
		}
	}
}
