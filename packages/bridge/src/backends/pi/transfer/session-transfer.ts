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
	readonly exporting: ExportDeps;
	readonly importing: ImportDeps;

	constructor(services: PiServices, store: SessionStore, now: () => number) {
		this.exporting = {
			store,
			desk: new ExportDesk(this.scratch),
			html: { agentDir: services.agentDir, modelRuntime: services.models.runtime },
		};
		this.importing = { store, uploads: new UploadDesk(this.scratch), now };
	}

	dispose(): Promise<void> {
		return this.scratch.dispose();
	}
}
