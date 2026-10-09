import { minimatch } from "minimatch";

const WITHOUT_SLASH_OPTIONS = { dot: true, matchBase: true } as const;
const WITH_SLASH_OPTIONS = { dot: true } as const;

/** A pattern without a slash matches a basename anywhere, like `fd --glob`; one with a slash matches the path. */
export function matchesGlob(relativePath: string, pattern: string): boolean {
	if (!pattern.includes("/")) return minimatch(relativePath, pattern, WITHOUT_SLASH_OPTIONS);
	const anchored = pattern.startsWith("**/") || pattern === "**" ? pattern : `**/${pattern}`;
	return minimatch(relativePath, anchored, WITH_SLASH_OPTIONS);
}
