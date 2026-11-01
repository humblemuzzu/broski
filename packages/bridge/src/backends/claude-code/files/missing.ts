/** Whether a filesystem error says the path is not there: no such entry, or a parent that is a file. */
export function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error.code === "ENOENT" || error.code === "ENOTDIR")
	);
}
