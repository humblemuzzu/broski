/** A path relative to the repository's root: never absolute, never leaving it, never read as an option. */
export function isSafePathSpec(pathSpec: string): boolean {
	if (!pathSpec) return false;
	if (pathSpec.startsWith("-")) return false;
	if (pathSpec.includes("\u0000")) return false;
	if (pathSpec.startsWith("/") || pathSpec.startsWith("~")) return false;
	if (pathSpec.split(/[\\/]+/).includes("..")) return false;
	return true;
}

export function isSafeBranchName(name: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/.test(name) && !name.includes("..");
}
