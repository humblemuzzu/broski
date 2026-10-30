/**
 * The directory the files in transit live in: exports waiting to be read by the phone and uploads waiting to be
 * checked. It is made at the first use, inside the system's temporary directory, never inside the user's agent
 * directory or a project, and is removed whole when the adapter is disposed.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class Scratch {
	private root: Promise<string> | undefined;

	/** A new empty directory of its own. */
	async makeDir(): Promise<string> {
		this.root ??= mkdtemp(join(tmpdir(), "broski-pi-transfer-"));
		const dir = join(await this.root, crypto.randomUUID());
		await mkdir(dir);
		return dir;
	}

	async remove(dir: string): Promise<void> {
		await rm(dir, { recursive: true, force: true });
	}

	async dispose(): Promise<void> {
		const root = this.root;
		this.root = undefined;
		if (root !== undefined) await rm(await root, { recursive: true, force: true });
	}
}
