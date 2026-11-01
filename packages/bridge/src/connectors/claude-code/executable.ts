import type { ClaudeCliPath } from "../../server/claude-cli-path";

type ExecutableProvider = () => ClaudeCliPath;

let provider: ExecutableProvider | null = null;

/** Set once by the server (`serve.ts`); without it the SDK resolves its optional package itself (dev, tests). */
export function setClaudeExecutableProvider(next: ExecutableProvider | null): void {
	provider = next;
}

/** The `pathToClaudeCodeExecutable` option for a `query()`; throws the user-facing reason when there is no binary. */
export function claudeExecutableOption(): { pathToClaudeCodeExecutable?: string } {
	if (!provider) return {};
	const cli = provider();
	if (!cli.ok) throw new Error(`Claude Code is not available: ${cli.reason}`);
	return { pathToClaudeCodeExecutable: cli.path };
}
