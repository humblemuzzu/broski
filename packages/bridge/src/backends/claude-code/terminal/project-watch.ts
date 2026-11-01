/** Lane G · one watcher per project directory under `configRoot()/projects/`, reporting changed transcripts. */

export class ProjectWatch {
	constructor(
		readonly projectDir: string,
		readonly changed: (path: string) => void,
	) {}

	start(): void {}

	stop(): void {}
}
