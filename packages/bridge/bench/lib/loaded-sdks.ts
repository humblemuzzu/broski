const SDK_PACKAGE_PATTERN = /node_modules\/(@anthropic-ai\/[^/]+|@earendil-works\/[^/]+)\//;

/** Which agent SDK packages the current process has evaluated, by package directory name. */
export function loadedAgentSdkPackages(): string[] {
	const packages = new Set<string>();
	for (const path of Object.keys(require.cache)) {
		const match = SDK_PACKAGE_PATTERN.exec(path);
		if (match?.[1]) packages.add(match[1]);
	}
	return [...packages].sort();
}
