/** Where an ask desk's own failure is written: stderr, since the adapter has no logger (layers allow only the contract). */

export function reportAskProblem(where: string, error: unknown): void {
	const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`[claude-code asks] ${where}: ${detail}\n`);
}
