import type { Metadata } from "next";
import { Steps, SuccessStep } from "@/components/docs";
import { FeatureCard, CardGrid, Card } from "@/components/docs";
import { CodeBlock } from "@/components/docs";
import { Callout } from "@/components/docs";
import { SimpleTable } from "@/components/docs";

export const metadata: Metadata = {
  title: "Documentation - Broski",
  description: "Broski documentation - Control your AI coding agents from your phone",
};

export default function DocsPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="broski" className="text-3xl font-bold mb-3">Broski</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Control your AI coding agents from your phone.
      </p>

      {/* What is Broski - Problem/Solution */}
      <section className="mb-10">
        <h2 id="what-is-broski" className="text-xl font-semibold mb-4">What is Broski?</h2>
        
        <div className="mb-6">
          <h3 className="text-base font-medium mb-2 text-muted-foreground">The Problem</h3>
          <p className="text-muted-foreground mb-4">
            You&apos;re working with an AI coding agent like Claude Code or OpenCode on your system. 
            It&apos;s powerful, but you have to be at your system to use it. What if you want to:
          </p>
          <ul className="text-muted-foreground space-y-1 ml-4 list-disc">
            <li>Review code changes while on the couch?</li>
            <li>Approve AI actions from a coffee shop?</li>
            <li>Monitor a long-running task during dinner?</li>
          </ul>
        </div>

        <div className="mb-6">
          <h3 className="text-base font-medium mb-2 text-muted-foreground">The Solution</h3>
          <p className="text-muted-foreground">
            <strong className="text-foreground">Broski turns your phone into a remote control for your AI coding agent.</strong>{" "}
            Your system does all the heavy lifting (running AI, executing code, managing files). 
            Your phone is simply a convenient interface that lets you interact with your AI assistant from anywhere.
          </p>
        </div>
      </section>

      {/* Architecture Diagram */}
      <section className="mb-10">
        <h2 id="how-it-works" className="text-xl font-semibold mb-4">How It Works</h2>
        
        <div className="flex flex-wrap items-center justify-center gap-3 py-6 px-4 bg-muted/30 rounded-lg border border-border mb-4">
          <div className="text-center">
            <div className="px-4 py-3 bg-primary/10 border border-primary/30 rounded-lg">
              <div className="font-semibold">Broski</div>
              <div className="text-xs text-muted-foreground">Mobile App</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">Your Phone</div>
          </div>
          <div className="text-muted-foreground text-lg">⟷</div>
          <div className="text-center">
            <div className="px-4 py-3 bg-muted border border-border rounded-lg">
              <div className="font-semibold">Bridge</div>
              <div className="text-xs text-muted-foreground">Server</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">Your System</div>
          </div>
          <div className="text-muted-foreground text-lg">⟷</div>
          <div className="text-center">
            <div className="px-4 py-3 bg-muted border border-border rounded-lg">
              <div className="font-semibold">AI Agent</div>
              <div className="text-xs text-muted-foreground">Claude/OpenCode</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">Your System</div>
          </div>
        </div>

        <ol className="text-muted-foreground space-y-2">
          <li><strong className="text-foreground">1. Bridge Server</strong> runs on your system alongside your AI coding assistant</li>
          <li><strong className="text-foreground">2. Broski App</strong> connects to the bridge via WebSocket (local WiFi or Tailscale)</li>
          <li><strong className="text-foreground">3. Full Sync</strong> - all messages, tool calls, and session state flow bidirectionally</li>
        </ol>
      </section>

      {/* Platform Support */}
      <section className="mb-10">
        <h2 id="platform-support" className="text-xl font-semibold mb-4">Platform Support</h2>
        
        <SimpleTable
          headers={["Platform", "Minimum Version", "Status"]}
          rows={[
            ["iOS", "15.0+", "Supported"],
            ["iPadOS", "15.0+", "Supported"],
            ["Android", "8.0+ (API 26)", "Supported"],
            ["macOS (Bridge)", "12.0+ (Monterey)", "Supported"],
            ["Windows (Bridge)", "10+ (WSL2)", "Supported"],
            ["Linux (Bridge)", "Ubuntu 20.04+", "Supported"],
          ]}
        />
      </section>

      {/* Supported Backends */}
      <section className="mb-10">
        <h2 id="supported-backends" className="text-xl font-semibold mb-4">Supported AI Backends</h2>
        
        <p className="text-muted-foreground mb-4">
          Broski connects to these AI coding agents running on your computer:
        </p>

        <SimpleTable
          headers={["Backend", "Description", "Status"]}
          rows={[
            [<strong key="cc">Claude Code</strong>, "Anthropic's official CLI for Claude", "Fully Supported"],
            [<strong key="oc">OpenCode</strong>, "Open-source AI coding assistant (multi-provider)", "Fully Supported"],
            [<strong key="cx">Codex</strong>, "OpenAI's CLI agent for GPT models", "Fully Supported"],
          ]}
        />

        <Callout type="info" title="Bring Your Own AI">
          Broski is an interface, not an AI provider. You&apos;ll need your own AI subscription 
          (Claude Pro, OpenAI API, etc.) configured in your chosen backend.
        </Callout>
      </section>

      {/* Quick Start */}
      <h2 id="quick-start" className="text-xl font-semibold mb-4">Quick Start</h2>
      
      <Steps
        steps={[
          {
            title: "Install the Bridge",
            description: "Run the bridge server on your system:",
            content: <CodeBlock language="bash">broski</CodeBlock>,
          },
          {
            title: "Download Broski",
            description: "Get Broski from the App Store (iOS) or Play Store (Android).",
          },
          {
            title: "Scan QR Code",
            description: "Open Broski, tap \"Scan QR Code\", and point your camera at the QR code in your terminal.",
          },
        ]}
      />
      
      <SuccessStep
        title="You're Connected!"
        description="Start chatting with your AI coding assistant from your phone."
      />

      {/* Features */}
      <h2 id="features" className="text-xl font-semibold mb-4 mt-10">Features</h2>
      
      <CardGrid>
        <FeatureCard
          title="Real-time Chat"
          description="Stream responses from Claude Code, OpenCode, or Codex at 60fps."
          color="primary"
        />
        <FeatureCard
          title="Code Review"
          description="Review diffs, approve file changes, grant or deny permissions."
          color="accent"
        />
        <FeatureCard
          title="Multi-Session"
          description="Work on multiple projects and sessions simultaneously."
          color="green"
        />
        <FeatureCard
          title="Remote Access"
          description="Access from anywhere via Tailscale VPN - coffee shop, airport, anywhere."
          color="amber"
        />
      </CardGrid>

      {/* Next Steps */}
      <h2 id="next-steps" className="text-xl font-semibold mb-4 mt-10">Next Steps</h2>

      <CardGrid>
        <Card
          href="/docs/setup"
          title="Setup Guide"
          description="Complete installation instructions for all platforms."
        />
        <Card
          href="/docs/app"
          title="Mobile App Guide"
          description="Sessions, chat, file browser, settings."
        />
        <Card
          href="/docs/bridge"
          title="Bridge Docs"
          description="Configuration, CLI options, and commands."
        />
        <Card
          href="/docs/backends"
          title="AI Backends"
          description="Claude Code, OpenCode, Codex setup guides."
        />
        <Card
          href="/docs/security"
          title="Security & Privacy"
          description="Zero cloud, zero telemetry. How your data stays yours."
        />
      </CardGrid>
    </article>
  );
}
