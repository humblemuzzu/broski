/** What went wrong, as one non-empty line a status issue or a rejection can carry. */
export function errorText(error: unknown): string {
	return error instanceof Error && error.message !== "" ? error.message : String(error);
}
