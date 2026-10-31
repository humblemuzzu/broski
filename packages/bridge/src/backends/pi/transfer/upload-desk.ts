/**
 * The uploads under way: one file each in the scratch directory, grown part by part in order. The phone names an
 * upload; the Mac keeps what it has received under that name until the upload is finished, a newer one pushes it out,
 * it lies idle (`held-files.ts`), or the adapter is disposed.
 */

import { appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { MAX_IMPORT_BYTES, type Rejected, type UploadId } from "../../../contract";
import { rejected } from "../rejections";
import { HeldFiles, TRANSFER_IDLE_MS } from "./held-files";
import type { Scratch } from "./scratch";

/** One phone sends one file at a time; a few more cover one it started over. */
const KEPT_UPLOADS = 4;
const UPLOAD_FILE = "upload.jsonl";

/** Registered at the first part, before its directory exists, so a second first part finds it busy. */
interface Upload {
	readonly dir: Promise<string>;
	received: number;
	busy: boolean;
}

export interface UploadDeskOptions {
	readonly limit?: number;
	readonly now?: () => number;
	readonly idleMs?: number;
}

export class UploadDesk {
	private readonly uploads: HeldFiles<Upload>;
	private readonly limit: number;

	constructor(
		private readonly scratch: Scratch,
		options: UploadDeskOptions = {},
	) {
		this.limit = options.limit ?? MAX_IMPORT_BYTES;
		this.uploads = new HeldFiles({
			kept: KEPT_UPLOADS,
			idleMs: options.idleMs ?? TRANSFER_IDLE_MS,
			now: options.now ?? Date.now,
			discard: (upload) =>
				upload.dir.then(
					(dir) => scratch.remove(dir),
					() => undefined,
				),
			inUse: (upload) => upload.busy,
		});
	}

	/** Appends `bytes` at `offset`, which is the number of bytes already held (0 starts the upload over); the bytes held after. */
	async take(uploadId: UploadId, offset: number, bytes: Buffer): Promise<number | Rejected> {
		const upload = this.claim(uploadId, offset);
		if ("rejection" in upload) return upload;
		try {
			const path = join(await upload.dir, UPLOAD_FILE);
			if (offset === 0 && upload.received > 0) {
				await rm(path, { force: true });
				upload.received = 0;
			}
			if (upload.received + bytes.length > this.limit) {
				await this.finish(uploadId);
				return rejected("invalid_input", `a session file may be at most ${this.limit} bytes`);
			}
			await appendFile(path, bytes);
			upload.received += bytes.length;
			return upload.received;
		} finally {
			upload.busy = false;
		}
	}

	/** Where the bytes received so far lie; undefined for an upload the Mac does not hold. */
	async pathOf(uploadId: UploadId): Promise<string | undefined> {
		const upload = this.uploads.use(uploadId);
		return upload === undefined ? undefined : join(await upload.dir, UPLOAD_FILE);
	}

	finish(uploadId: UploadId): Promise<void> {
		return this.uploads.release(uploadId);
	}

	/** Forgets every upload; their files go with the scratch directory. */
	dispose(): void {
		this.uploads.clear();
	}

	/** The upload this part continues, marked busy before anything is awaited, so two parts never both take it. */
	private claim(uploadId: UploadId, offset: number): Upload | Rejected {
		const known = this.uploads.use(uploadId);
		if (known?.busy) return rejected("busy", "the previous part of this upload is still being taken");
		if (known === undefined && offset !== 0) {
			return rejected(
				"invalid_input",
				"the Mac holds no part of this upload (it keeps only the newest few); start again",
			);
		}
		if (known !== undefined && offset !== 0 && offset !== known.received) {
			return rejected("invalid_input", `the Mac holds ${known.received} bytes of this upload; send from there`);
		}
		const upload = known ?? { dir: this.scratch.makeDir(), received: 0, busy: false };
		upload.busy = true;
		if (known === undefined) this.uploads.add(uploadId, upload);
		return upload;
	}
}
