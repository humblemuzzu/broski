import type { Metadata } from "next";
import Image from "next/image";
import { CodeBlock, Callout, CardGrid, Card, Steps } from "@/components/docs";

export const metadata: Metadata = {
  title: "Bridge - Broski",
  description: "Connect your phone to AI coding agents",
};

export default function BridgePage() {
  return (
    <article className="max-w-2xl">
      <h1 id="bridge" className="text-3xl font-bold mb-3">Broski Bridge</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Connect your phone to AI coding agents on your Mac.
      </p>

      <h2 id="install" className="text-xl font-semibold mb-4">Installation</h2>
      
      <CodeBlock language="bash">{`bunx broski`}</CodeBlock>
      
      <p className="text-sm text-muted-foreground mt-2">
        Or: <code className="text-foreground">npx broski</code>
      </p>

      <h2 id="commands" className="text-xl font-semibold mb-4 mt-10">Commands</h2>
      
      <CodeBlock language="bash">{`broski              # Start server
broski --port 9000  # Custom port
broski --help       # Show help
broski --version    # Show version`}</CodeBlock>

      <h2 id="how-it-works" className="text-xl font-semibold mb-4 mt-10">How It Works</h2>
      
      <Steps
        steps={[
          { title: "Bridge starts", description: "WebSocket server runs on your Mac with a QR code" },
          { title: "Phone connects", description: "Scan QR with Broski app (same WiFi or Tailscale)" },
          { title: "Messages relay", description: "Your messages go to AI agent, responses stream back" },
        ]}
      />

      <h2 id="agents" className="text-xl font-semibold mb-4 mt-10">Supported Agents</h2>
      
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col items-center p-3 border border-border/40 rounded-lg">
          <Image src="/logos/anthropic.svg" alt="Claude" width={24} height={24} className="mb-2" />
          <span className="text-xs font-medium">Claude Code</span>
        </div>
        <div className="flex flex-col items-center p-3 border border-border/40 rounded-lg">
          <Image src="/logos/opencode.svg" alt="OpenCode" width={24} height={24} className="mb-2" />
          <span className="text-xs font-medium">OpenCode</span>
        </div>
        <div className="flex flex-col items-center p-3 border border-border/40 rounded-lg">
          <Image src="/logos/openai.svg" alt="Codex" width={24} height={24} className="mb-2" />
          <span className="text-xs font-medium">Codex</span>
        </div>
      </div>

      <h2 id="security" className="text-xl font-semibold mb-4 mt-10">Security</h2>
      
      <Callout type="tip" title="Privacy by Design">
        All traffic stays on your local network. No data sent to Broski servers.
        Connection secured with random token on each start.
      </Callout>

      <h2 id="next" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/bridge/configuration" title="Configuration" description="Ports and settings" />
        <Card href="/docs/bridge/remote-access" title="Remote Access" description="Tailscale setup" />
      </CardGrid>
    </article>
  );
}
