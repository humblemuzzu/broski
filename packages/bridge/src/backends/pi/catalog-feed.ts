/** The backend's catalog sink, silenced once the backend is disposed (contract README §5, rule 4). */

import type { CatalogEvent, CatalogSink } from "../../contract";

export class CatalogFeed {
	private silenced = false;

	constructor(private readonly sink: CatalogSink) {}

	emit(event: CatalogEvent): void {
		if (!this.silenced) this.sink.emit(event);
	}

	silence(): void {
		this.silenced = true;
	}
}
