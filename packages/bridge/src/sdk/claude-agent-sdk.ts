import { createLazyModule } from "./lazy-module";

const claude = createLazyModule("the Claude Agent SDK", () => import("@anthropic-ai/claude-agent-sdk"));

export const loadClaudeAgentSdk = claude.load;
export const claudeAgentSdk = claude.get;
