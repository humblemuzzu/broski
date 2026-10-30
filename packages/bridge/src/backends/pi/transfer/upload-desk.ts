/**
 * The uploads under way: one file each in the scratch directory, grown part by part in order. The phone names an
 * upload; the Mac keeps what it has received under that name until the upload is finished, a newer one pushes it out,
 * or the adapter is disposed.
 */

import { appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { MAX_IMPORT_BYTES, type Rejected, type UploadId } from "../../../contract";
import { rejected } from "../rejections";
import type { Scratch } from "./scratch";

/** One phone sends one file at a time; a few more cover one it started over. */
const KEPT_UPLOADS = 4;

interface Upload {
	readonly dir: string;
	readonly path: string;
	received: number;
	busy: boolean;
}

export class UploadDesk {
	private readonly uploads = new Map<UploadId, Upload>();

	constructor(
		private readonly scratch: Scratch,
		private readonly limit = MAX_IMPORT_BYTES,
	) {}

	/** Appends `bytes` at `offset`, which is the number of bytes already held (0 starts the upload over); the bytes held after. */
	async take(uploadId: UploadId, offset: number, bytes: Buffer): Promise<number | Rejected> {
		const upload = await this.upload(uploadId, offset);
		if ("rejection" in upload) return upload;
		if (upload.busy) return rejected("busy", "the previous part of this upload is still being taken");
		if (offset !== upload.received) {
			return rejected("invalid_input", `the Mac holds ${upload.received} bytes of this upload; send from there`);
		}
		if (upload.received + bytes.length > this.limit) {
			await this.finish(uploadId);
			return rejected("invalid_input", `a session file may be at most ${this.limit} bytes`);
		}
		upload.busy = true;
		try {
			await appendFile(upload.path, bytes);
			upload.received += bytes.length;
			return upload.received;
		} finally {
			upload.busy = false;
		}
	}

	/** Where the bytes received so far lie; undefined for an upload the Mac does not hold. */
	pathOf(uploadId: UploadId): string | undefined {
		return this.uploads.get(uploadId)?.path;
	}

	async finish(uploadId: UploadId): Promise<void> {
		const upload = this.uploads.get(uploadId);
		this.uploads.delete(uploadId);
		if (upload !== undefined) await this.scratch.remove(upload.dir);
	}

	private async upload(uploadId: UploadId, offset: number): Promise<Upload | Rejected> {
		const known = this.uploads.get(uploadId);
		if (known !== undefined && offset === 0 && known.received > 0 && !known.busy) {
			await rm(known.path, { force: true });
			known.received = 0;
		}
		if (known !== undefined) return known;
		if (offset !== 0) {
			return rejected(
				"invalid_input",
				"the Mac holds no part of this upload (it keeps only the newest few); start again",
			);
		}
		const dir = await this.scratch.makeDir();
		const started: Upload = { dir, path: join(dir, "upload.jsonl"), received: 0, busy: false };
		this.uploads.set(uploadId, started);
		for (const oldest of this.uploads.keys()) {
			if (this.uploads.size <= KEPT_UPLOADS) break;
			await this.finish(oldest);
		}
		return started;
	}
}
