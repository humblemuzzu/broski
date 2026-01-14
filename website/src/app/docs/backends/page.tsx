import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { SimpleTable, Callout } from "@/components/docs";

export const metadata: Metadata = {
  title: "AI Backends - Broski",
  description: "Claude Code, OpenCode, and Codex support",
};

export default function BackendsOverviewPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="backends" className="text-3xl font-bold mb-3">AI Backends</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Broski supports three AI coding agents.
      </p>

      <h2 id="choose" className="text-xl font-semibold mb-4">Choose a Backend</h2>
      
      <div className="grid gap-3">
        <Link 
          href="/docs/backends/claude-code"
          className="flex items-center gap-4 p-4 border border-border/40 rounded-lg hover:border-[#cc785c]/40 hover:bg-[#cc785c]/5 transition-colors"
        >
          <Image src="/logos/anthropic.svg" alt="Claude" width={32} height={32} className="shrink-0" />
          <div>
            <h3 className="font-medium text-sm">Claude Code</h3>
            <p className="text-xs text-muted-foreground">Anthropic&apos;s official agent</p>
          </div>
        </Link>

        <Link 
          href="/docs/backends/opencode"
          className="flex items-center gap-4 p-4 border border-border/40 rounded-lg hover:border-primary/40 hover:bg-primary/5 transition-colors"
        >
          <Image src="/logos/opencode.svg" alt="OpenCode" width={32} height={32} className="shrink-0" />
          <div>
            <h3 className="font-medium text-sm">OpenCode</h3>
            <p className="text-xs text-muted-foreground">Multi-provider (default)</p>
          </div>
        </Link>

        <Link 
          href="/docs/backends/codex"
          className="flex items-center gap-4 p-4 border border-border/40 rounded-lg hover:border-[#10a37f]/40 hover:bg-[#10a37f]/5 transition-colors"
        >
          <Image src="/logos/openai.svg" alt="Codex" width={32} height={32} className="shrink-0" />
          <div>
            <h3 className="font-medium text-sm">Codex (OpenAI)</h3>
            <p className="text-xs text-muted-foreground">GPT models via OpenCode</p>
          </div>
        </Link>
      </div>

      <h2 id="comparison" className="text-xl font-semibold mb-4 mt-10">Comparison</h2>
      
      <SimpleTable
        headers={["", "Claude Code", "OpenCode", "Codex"]}
        rows={[
          ["Providers", "Claude only", "17+ providers", "OpenAI"],
          ["MCP", <strong key="1">Yes</strong>, <strong key="2">Full</strong>, <strong key="3">Yes</strong>],
          ["Thinking", <strong key="4">Yes</strong>, "Model-dep", "Limited"],
          ["Best for", "Claude users", "Flexibility", "GPT users"],
        ]}
      />

      <h2 id="switching" className="text-xl font-semibold mb-4 mt-10">Switching Backends</h2>
      
      <Callout type="info">
        Go to <strong>Settings</strong> &rarr; <strong>AI Backend</strong> in the Broski app to switch.
        Make sure the backend is installed on your Mac.
      </Callout>
    </article>
  );
}
