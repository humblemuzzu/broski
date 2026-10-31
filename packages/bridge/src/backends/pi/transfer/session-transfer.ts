/** The files in transit for one adapter: its exports and uploads, sharing one scratch directory that ends with it. */

import type { ExportDeps } from "../ops/export-session";
import type { ImportDeps } from "../ops/import-session";
import type { SessionStore } from "../ports";
import type { PiServices } from "../services";
import { ExportDesk } from "./export-desk";
import { Scratch } from "./scratch";
import { UploadDesk } from "./upload-desk";

export class SessionTransfer {
	private readonly scratch = new Scratch();
	private readonly exports: ExportDesk;
	private readonly uploads: UploadDesk;
	readonly exporting: ExportDeps;
	readonly importing: ImportDeps;

	constructor(services: PiServices, store: SessionStore, now: () => number) {
		this.exports = new ExportDesk(this.scratch, { now });
		this.uploads = new UploadDesk(this.scratch, { now });
		this.exporting = {
			store,
			desk: this.exports,
			html: { agentDir: services.agentDir, modelRuntime: services.models.runtime },
		};
		this.importing = { store, uploads: this.uploads, now };
	}

	dispose(): Promise<void> {
		this.exports.dispose();
		this.uploads.dispose();
		return this.scratch.dispose();
	}
}
