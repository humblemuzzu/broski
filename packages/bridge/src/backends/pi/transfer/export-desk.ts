/**
 * The exports waiting for the phone to read them: one file each, in a directory of its own, named by an id only the
 * answer to `export_session` carries. The newest few are kept; an older one goes when a newer is added or when it
 * lies idle (`held-files.ts`), and all go with the scratch directory when the adapter is disposed.
 */

import { stat } from "node:fs/promises";
import type { ExportId, SessionId } from "../../../contract";
import { HeldFiles, TRANSFER_IDLE_MS } from "./held-files";
import type { Scratch } from "./scratch";

/** A phone reads one export at a time; a few more cover one it started over and a second phone. */
const KEPT_EXPORTS = 4;

export interface ExportedFile {
	readonly exportId: ExportId;
	readonly sessionId: SessionId;
	readonly dir: string;
	readonly path: string;
	readonly name: string;
	readonly mimeType: string;
	readonly bytes: number;
}

/** Where an export is being written; `keep` registers it once the file is complete. */
export interface ExportSlot {
	readonly exportId: ExportId;
	readonly dir: string;
}

export interface ExportDeskOptions {
	readonly now?: () => number;
	readonly idleMs?: number;
}

export class ExportDesk {
	private readonly kept: HeldFiles<ExportedFile>;

	constructor(
		private readonly scratch: Scratch,
		options: ExportDeskOptions = {},
	) {
		this.kept = new HeldFiles({
			kept: KEPT_EXPORTS,
			idleMs: options.idleMs ?? TRANSFER_IDLE_MS,
			now: options.now ?? Date.now,
			discard: (file) => scratch.remove(file.dir),
		});
	}

	async slot(): Promise<ExportSlot> {
		this.kept.sweep();
		return { exportId: crypto.randomUUID(), dir: await this.scratch.makeDir() };
	}

	/** Registers the file at `path` (inside `slot.dir`) as the export `slot` stands for. */
	async keep(
		slot: ExportSlot,
		file: Pick<ExportedFile, "sessionId" | "path" | "name" | "mimeType">,
	): Promise<ExportedFile> {
		const exported = { ...file, exportId: slot.exportId, dir: slot.dir, bytes: (await stat(file.path)).size };
		this.kept.add(slot.exportId, exported);
		return exported;
	}

	abandon(slot: ExportSlot): Promise<void> {
		return this.scratch.remove(slot.dir);
	}

	/** The export `exportId`, when it was made of `sessionId`'s file. */
	find(exportId: ExportId, sessionId: SessionId): ExportedFile | undefined {
		const found = this.kept.use(exportId);
		return found?.sessionId === sessionId ? found : undefined;
	}

	/** Forgets every export; their files go with the scratch directory. */
	dispose(): void {
		this.kept.clear();
	}
}
