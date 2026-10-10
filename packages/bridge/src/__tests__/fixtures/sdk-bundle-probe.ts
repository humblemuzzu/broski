/**
 * Compiled-bundle probe: proves a `bun build --compile --bytecode --format=esm` binary
 * resolves every lazily imported agent SDK.
 *
 *   bun build --compile --bytecode --format=esm --target=bun-darwin-arm64 \
 *     src/__tests__/fixtures/sdk-bundle-probe.ts --outfile /tmp/sdk-bundle-probe
 *   /tmp/sdk-bundle-probe   # expect: BUNDLED_SDKS function,function,function,function,object,function,object
 */

import { loadChordContext } from "../../sdk/chord";
import { loadClaudeAgentSdk } from "../../sdk/claude-agent-sdk";
import { loadOpenCodeSdk } from "../../sdk/opencode-sdk";
import { loadPiAiBunOAuth } from "../../sdk/pi-ai";
import { loadPiCodingAgent } from "../../sdk/pi-coding-agent";
import { loadPiDurable, loadPiDurableNodeStorage } from "../../sdk/pi-durable";

const claude = await loadClaudeAgentSdk();
const opencode = await loadOpenCodeSdk();
const pi = await loadPiCodingAgent();
const oauth = await loadPiAiBunOAuth();
const durable = await loadPiDurable();
const durableStorage = await loadPiDurableNodeStorage();
const chord = await loadChordContext();

console.log(
	`BUNDLED_SDKS ${[
		typeof claude.query,
		typeof opencode.createOpencodeClient,
		typeof pi.createAgentSession,
		typeof oauth.registerBunOAuthFlows,
		typeof durable.Harness,
		typeof durableStorage.openNodeJsonlStorage,
		typeof chord.BACKGROUND_CONTEXT,
	].join(",")}`,
);
