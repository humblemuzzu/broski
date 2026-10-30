/**
 * The exports waiting for the phone to read them: one file each, in a directory of its own, named by an id only the
 * answer to `export_session` carries. The newest few are kept; an older one goes when a newer is added, and all go
 * with the scratch directory when the adapter is disposed.
 */

import { stat } from "node:fs/promises";
import type { ExportId, SessionId } from "../../../contract";
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

export class ExportDesk {
	private readonly kept = new Map<ExportId, ExportedFile>();

	constructor(private readonly scratch: Scratch) {}

	async slot(): Promise<ExportSlot> {
		return { exportId: crypto.randomUUID(), dir: await this.scratch.makeDir() };
	}

	/** Registers the file at `path` (inside `slot.dir`) as the export `slot` stands for. */
	async keep(
		slot: ExportSlot,
		file: Pick<ExportedFile, "sessionId" | "path" | "name" | "mimeType">,
	): Promise<ExportedFile> {
		const exported = { ...file, exportId: slot.exportId, dir: slot.dir, bytes: (await stat(file.path)).size };
		this.kept.set(slot.exportId, exported);
		for (const [oldest, old] of this.kept) {
			if (this.kept.size <= KEPT_EXPORTS) break;
			this.kept.delete(oldest);
			void this.scratch.remove(old.dir);
		}
		return exported;
	}

	abandon(slot: ExportSlot): Promise<void> {
		return this.scratch.remove(slot.dir);
	}

	/** The export `exportId`, when it was made of `sessionId`'s file. */
	find(exportId: ExportId, sessionId: SessionId): ExportedFile | undefined {
		const found = this.kept.get(exportId);
		return found?.sessionId === sessionId ? found : undefined;
	}
}
