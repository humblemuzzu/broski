import type { Metadata } from "next";
import { Steps, SuccessStep } from "@/components/docs";
import { FeatureCard, CardGrid, Card } from "@/components/docs";
import { CodeBlock } from "@/components/docs";
import { Callout } from "@/components/docs";

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

      <Callout type="info" title="What is Broski?">
        Broski connects to AI coding assistants (Claude Code, OpenCode, Codex) running on your Mac.
        Chat with AI, review code changes, and approve file modifications - all from your phone.
      </Callout>

      <h2 id="quick-start" className="text-xl font-semibold mb-4 mt-10">Quick Start</h2>
      
      <Steps
        steps={[
          {
            title: "Install the Bridge",
            description: "Run the bridge server on your Mac:",
            content: <CodeBlock language="bash">bunx broski</CodeBlock>,
          },
          {
            title: "Download Broski",
            description: "Get Broski from the App Store on your iPhone or iPad.",
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

      <h2 id="features" className="text-xl font-semibold mb-4 mt-10">Features</h2>
      
      <CardGrid>
        <FeatureCard
          title="Real-time Chat"
          description="Stream responses from Claude Code, OpenCode, or Codex."
          color="primary"
        />
        <FeatureCard
          title="Code Review"
          description="Review diffs, approve changes, manage permissions."
          color="accent"
        />
        <FeatureCard
          title="Multi-Session"
          description="Work on multiple projects simultaneously."
          color="green"
        />
        <FeatureCard
          title="Remote Access"
          description="Access from anywhere via Tailscale VPN."
          color="amber"
        />
      </CardGrid>

      <h2 id="next-steps" className="text-xl font-semibold mb-4 mt-10">Next Steps</h2>
      
      <CardGrid>
        <Card
          href="/docs/setup"
          title="Setup Guide"
          description="Complete installation instructions."
        />
        <Card
          href="/docs/bridge"
          title="Bridge Docs"
          description="Configuration and commands."
        />
        <Card
          href="/docs/backends"
          title="AI Backends"
          description="Claude Code, OpenCode, Codex."
        />
        <Card
          href="/docs/troubleshooting"
          title="Troubleshooting"
          description="Solutions to common issues."
        />
      </CardGrid>
    </article>
  );
}
