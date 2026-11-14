import { createRequire } from "node:module";

/**
 * The `claude` binary the tests run: the one in the SDK's optional per-platform package in this checkout's
 * `node_modules`. It is the CLI the pinned SDK was released with (`EXPECTED_CLAUDE_CLI_VERSION`), so every
 * machine and CI run the tests against the same CLI whatever the developer has installed. The bridge itself
 * never runs it: production runs the user's own `claude` (`server/claude-cli-path.ts`).
 */
export function testClaudeBinary(): string {
	const sdkEntry = createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk");
	return createRequire(sdkEntry).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
}
