/** A module that loads both agent SDKs, so the import probe can show it detects a loaded SDK. */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { createAgentSessionRuntime } from "@earendil-works/pi-coding-agent";

console.log(`LOADED_SDKS ${[typeof query, typeof createAgentSessionRuntime].join(",")}`);
