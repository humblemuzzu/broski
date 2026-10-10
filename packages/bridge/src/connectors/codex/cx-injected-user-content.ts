/** Codex writes injected tags (`<turn_aborted>`, `<recommended_plugins>`) as user-role content; a typed prompt does not open with one. */
const CONTEXT_TAG = /^<[a-z_]+>/;

const INJECTED_TEXT_PREFIXES = ["# AGENTS.md", "# Repository Guidelines", "# Continuity Ledger"];

export function isInjectedUserContent(text: string): boolean {
	const trimmed = text.trimStart();
	if (CONTEXT_TAG.test(trimmed)) return true;
	return INJECTED_TEXT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}
