/**
 * The directory the files in transit live in: exports waiting to be read by the phone and uploads waiting to be
 * checked. It is made at the first use, inside the system's temporary directory, never inside the user's agent
 * directory or a project, and is removed whole when the adapter is disposed; after that it makes nothing.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class Scratch {
	private root: Promise<string> | undefined;
	private disposed = false;

	constructor(private readonly parent: () => string = tmpdir) {}

	/** A new empty directory of its own. */
	async makeDir(): Promise<string> {
		if (this.disposed) throw new Error("the transfer area is closed: the backend was disposed");
		this.root ??= this.makeRoot();
		const dir = join(await this.root, crypto.randomUUID());
		await mkdir(dir);
		return dir;
	}

	async remove(dir: string): Promise<void> {
		await rm(dir, { recursive: true, force: true });
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		const root = this.root;
		this.root = undefined;
		const dir = await root?.catch(() => undefined);
		if (dir !== undefined) await rm(dir, { recursive: true, force: true });
	}

	/** A root that could not be made is forgotten, so the next use tries again. */
	private makeRoot(): Promise<string> {
		const made = mkdtemp(join(this.parent(), "broski-pi-transfer-"));
		made.catch(() => {
			if (this.root === made) this.root = undefined;
		});
		return made;
	}
}
