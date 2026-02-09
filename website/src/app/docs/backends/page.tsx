import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SimpleTable, Callout, CodeBlock } from "@/components/docs";

export const metadata: Metadata = {
  title: "AI Backends - Broski",
  description: "Claude Code, OpenCode, and Codex support",
};

export default function BackendsOverviewPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="backends" className="text-3xl font-bold mb-3">AI Backends</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Broski connects to AI coding agents running on your computer. Choose the backend that fits your workflow.
      </p>

      <h2 id="what-is-backend" className="text-xl font-semibold mb-4">What is an AI Backend?</h2>
      <p className="text-sm text-muted-foreground mb-4">
        An AI backend is the coding agent that runs on your system. It handles communication with AI models 
        (Claude, GPT, etc.), executes tools like file edits and shell commands, and manages your coding sessions.
      </p>
      <p className="text-sm text-muted-foreground mb-6">
        Broski doesn&apos;t run AI models directly &mdash; it connects to these backends via the bridge server, 
        giving you mobile access to powerful desktop coding agents.
      </p>

      <h2 id="how-it-works" className="text-xl font-semibold mb-4">How Backends Work with Broski</h2>
      
      <div className="bg-muted/30 rounded-lg border border-border p-6 mb-4">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="px-4 py-3 bg-primary/10 border border-primary/30 rounded-lg text-center">
            <div className="font-semibold text-sm">Broski App</div>
            <div className="text-xs text-muted-foreground">Phone</div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">⟷</div>
            <div className="text-xs text-muted-foreground">WebSocket</div>
          </div>
          <div className="px-4 py-3 bg-muted border border-border rounded-lg text-center">
            <div className="font-semibold text-sm">Bridge</div>
            <div className="text-xs text-muted-foreground">Server</div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">⟷</div>
            <div className="text-xs text-muted-foreground">API</div>
          </div>
          <div className="px-4 py-3 bg-muted border border-border rounded-lg text-center">
            <div className="font-semibold text-sm">Backend</div>
            <div className="text-xs text-muted-foreground">Agent</div>
          </div>
          <div className="text-muted-foreground">→</div>
          <div className="px-4 py-3 bg-muted border border-border rounded-lg text-center">
            <div className="font-semibold text-sm">AI Model</div>
            <div className="text-xs text-muted-foreground">Claude, GPT...</div>
          </div>
        </div>
      </div>
      
      <p className="text-sm text-muted-foreground mb-8">
        The bridge server starts with your chosen backend and relays messages between the Broski app and the agent.
      </p>

      <h2 id="choose" className="text-xl font-semibold mb-4">Choose a Backend</h2>
      
      <div className="grid gap-3 mb-8">
        <Link 
          href="/docs/backends/claude-code"
          className="flex items-center gap-4 p-4 border border-border/40 rounded-lg hover:border-[#cc785c]/40 hover:bg-[#cc785c]/5 transition-colors"
        >
          <Image src="/logos/anthropic.svg" alt="Claude" width={32} height={32} className="shrink-0" />
          <div>
            <div className="font-medium text-sm">Claude Code</div>
            <p className="text-xs text-muted-foreground">Anthropic&apos;s official agent &mdash; extended thinking, plugins, subagents</p>
          </div>
        </Link>

        <Link 
          href="/docs/backends/opencode"
          className="flex items-center gap-4 p-4 border border-border/40 rounded-lg hover:border-primary/40 hover:bg-primary/5 transition-colors"
        >
          <Image src="/logos/opencode.svg" alt="OpenCode" width={32} height={32} className="shrink-0" />
          <div>
            <div className="font-medium text-sm">OpenCode</div>
            <p className="text-xs text-muted-foreground">Multi-provider &mdash; use Anthropic, OpenAI, Google, or 75+ providers with one tool</p>
          </div>
        </Link>

        <Link 
          href="/docs/backends/codex"
          className="flex items-center gap-4 p-4 border border-border/40 rounded-lg hover:border-[#10a37f]/40 hover:bg-[#10a37f]/5 transition-colors"
        >
          <Image src="/logos/openai.svg" alt="Codex" width={32} height={32} className="shrink-0" />
          <div>
            <div className="font-medium text-sm">Codex</div>
            <p className="text-xs text-muted-foreground">OpenAI&apos;s official agent &mdash; native sandbox, own tooling system</p>
          </div>
        </Link>
      </div>

      <h2 id="decision-guide" className="text-xl font-semibold mb-4">Which Backend Should I Use?</h2>
      
      <div className="space-y-4 mb-8">
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Use Claude Code if you...</div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Want Anthropic&apos;s official CLI agent experience</li>
            <li>Need extended thinking, plugins, and subagents</li>
            <li>Use Claude models exclusively</li>
          </ul>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Use OpenCode if you...</div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Want flexibility to switch between providers (Anthropic, OpenAI, Google, 75+ more)</li>
            <li>Prefer open-source with full customization</li>
            <li>Need extensive MCP server integration</li>
          </ul>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Use Codex if you...</div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Want OpenAI&apos;s official CLI agent experience</li>
            <li>Need built-in sandboxing for command execution</li>
            <li>Use OpenAI models exclusively</li>
          </ul>
        </div>
      </div>

      <h2 id="comparison" className="text-xl font-semibold mb-4">Feature Comparison</h2>
      
      <SimpleTable
        headers={["Feature", "Claude Code", "OpenCode", "Codex"]}
        rows={[
          ["Provider", "Anthropic", "75+ providers", "OpenAI"],
          ["Own Tooling", "Yes", "Yes", "Yes"],
          ["MCP Support", "Yes", "Full", "Yes"],
          ["Subagents", "Yes", "Yes", "Yes"],
          ["Sandbox Mode", "No", "No", "Yes (built-in)"],
          ["Open Source", "No", "Yes", "Yes"],
        ]}
      />

      <h2 id="session-compatibility" className="text-xl font-semibold mb-4 mt-10">Session Compatibility</h2>
      
      <Callout type="info">
        Sessions are backend-specific. When you switch backends, your sessions from the previous backend 
        are hidden (not deleted). Switch back anytime to see them again.
      </Callout>
      
      <SimpleTable
        headers={["Scenario", "What Happens"]}
        rows={[
          ["Switch OpenCode → Claude Code", "OpenCode sessions hidden, Claude Code sessions shown"],
          ["Switch Claude Code → OpenCode", "Claude Code sessions hidden, OpenCode sessions shown"],
          ["Sessions deleted?", "No — both session sets are preserved"],
          ["Transfer sessions?", "No — sessions cannot migrate between backends"],
        ]}
      />

      <h2 id="switching" className="text-xl font-semibold mb-4 mt-10">Switching Backends</h2>
      
      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">From the App</div>
          <p className="text-xs text-muted-foreground">
            Go to <strong>Settings</strong> → <strong>AI Backend</strong> and select your preferred backend.
            The app will reconnect automatically.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">From the Command Line</div>
          <CodeBlock language="bash">{`# Default (OpenCode)
broski

# The backend is selected in the app settings
# Switch backends from Settings → AI Backend in the app`}</CodeBlock>
        </div>
      </div>

      <Callout type="tip">
        Make sure the backend CLI is installed on your system before selecting it in the app. 
        See individual backend pages for installation instructions.
      </Callout>
    </article>
  );
}
