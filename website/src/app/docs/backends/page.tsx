import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SimpleTable, Callout, CodeBlock } from "@/components/docs";

export const metadata: Metadata = {
  title: "AI Backends - Broski",
  description: "Claude Code and Pi support",
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
          href="/docs/backends/pi"
          className="flex items-center gap-4 p-4 border border-border/40 rounded-lg hover:border-[#7c3aed]/40 hover:bg-[#7c3aed]/5 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-[#7c3aed]/10 flex items-center justify-center shrink-0">
            <span className="text-[#7c3aed] font-bold text-sm">π</span>
          </div>
          <div>
            <div className="font-medium text-sm">Pi</div>
            <p className="text-xs text-muted-foreground">Open-source agent &mdash; multi-provider, extensions, session tree</p>
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
          <div className="font-medium mb-2 text-sm">Use Pi if you...</div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Want multi-provider flexibility with an extension system</li>
            <li>Need session tree navigation with fork and branch support</li>
            <li>Prefer open-source with customizable skills and tools</li>
          </ul>
        </div>
      </div>

      <h2 id="comparison" className="text-xl font-semibold mb-4">Feature Comparison</h2>
      
      <SimpleTable
        headers={["Feature", "Claude Code", "Pi"]}
        rows={[
          ["Provider", "Anthropic", "Multi (any)"],
          ["Own Tooling", "Yes", "Yes"],
          ["MCP Support", "Yes", "No"],
          ["Subagents", "Yes", "No"],
          ["Extensions", "Plugins", "Yes (plugin API)"],
          ["Session Tree", "No", "Yes"],
          ["Open Source", "No", "Yes"],
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
          ["Switch Pi → Claude Code", "Pi sessions hidden, Claude Code sessions shown"],
          ["Switch Claude Code → Pi", "Claude Code sessions hidden, Pi sessions shown"],
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
          <CodeBlock language="bash">{`# Start the bridge
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
