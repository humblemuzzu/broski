import { createLazyModule } from "./lazy-module";

type ClaudeAgentSdk = typeof import("@anthropic-ai/claude-agent-sdk");

const claude = createLazyModule<ClaudeAgentSdk>("the Claude Agent SDK", () => import("@anthropic-ai/claude-agent-sdk"));

let testOverride: ClaudeAgentSdk | null = null;

export function setClaudeAgentSdkForTests(sdk: ClaudeAgentSdk | null): void {
	testOverride = sdk;
}

export const loadClaudeAgentSdk = (): Promise<ClaudeAgentSdk> =>
	testOverride ? Promise.resolve(testOverride) : claude.load();
export const claudeAgentSdk = claude.get;
