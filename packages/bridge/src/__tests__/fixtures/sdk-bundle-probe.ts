/**
 * Compiled-bundle probe: proves a `bun build --compile --bytecode --format=esm` binary
 * resolves every lazily imported agent SDK.
 *
 *   bun build --compile --bytecode --format=esm --target=bun-darwin-arm64 \
 *     src/__tests__/fixtures/sdk-bundle-probe.ts --outfile /tmp/sdk-bundle-probe
 *   /tmp/sdk-bundle-probe   # expect: BUNDLED_SDKS function,function,function
 */

import { loadClaudeAgentSdk } from "../../sdk/claude-agent-sdk";
import { loadOpenCodeSdk } from "../../sdk/opencode-sdk";

const claude = await loadClaudeAgentSdk();
const opencode = await loadOpenCodeSdk();
const pi = await import("@earendil-works/pi-coding-agent");

console.log(
	`BUNDLED_SDKS ${[typeof claude.query, typeof opencode.createOpencodeClient, typeof pi.createAgentSessionRuntime].join(",")}`,
);
