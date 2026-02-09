import type { Metadata } from "next";
import Image from "next/image";
import { CodeBlock, Callout, CardGrid, Card, Steps, SimpleTable } from "@/components/docs";

export const metadata: Metadata = {
  title: "Bridge - Broski",
  description: "Connect your phone to AI coding agents",
};

export default function BridgePage() {
  return (
    <article className="max-w-3xl">
      <h1 id="bridge" className="text-3xl font-bold mb-3">Broski Bridge</h1>
      <p className="text-lg text-muted-foreground mb-8">
        The bridge server connects your phone to AI coding agents running on your computer.
      </p>

      <h2 id="what-is-the-bridge" className="text-2xl font-semibold mb-4">What is the Bridge?</h2>
      <p className="text-muted-foreground mb-4">
        The Broski Bridge is a lightweight server that runs on your desktop (Mac, Linux, or Windows) 
        and acts as the communication hub between your phone and the AI coding agent. It serves two 
        critical purposes:
      </p>
      <ul className="list-disc list-inside space-y-2 text-muted-foreground mb-6">
        <li><strong className="text-foreground">Protocol Translation</strong> - Converts WebSocket messages from your phone into API calls to the AI backend</li>
        <li><strong className="text-foreground">Network Bridging</strong> - Makes your local AI agent accessible from anywhere via multiple connection methods</li>
      </ul>

      <h2 id="install" className="text-2xl font-semibold mb-4 mt-10">Installation</h2>
      
      <CodeBlock language="bash">{`broski`}</CodeBlock>

      <Callout type="info" title="Verify your setup">
        Run <code>broski doctor</code> to check that everything is configured correctly.
      </Callout>

      <h2 id="commands" className="text-2xl font-semibold mb-4 mt-10">Commands</h2>
      
      <CodeBlock language="bash">{`broski                # Start server (default)
broski install        # Install as background service
broski uninstall      # Remove background service
broski status         # Check if bridge is running
broski stop           # Stop background service
broski qr             # Show QR code to pair phone
broski doctor         # Check system requirements
broski setup-tailscale # Set up Tailscale for remote access`}</CodeBlock>

      <h2 id="architecture" className="text-2xl font-semibold mb-4 mt-10">Architecture</h2>
      
      <div className="bg-muted/30 rounded-lg border border-border p-6 mb-6">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Phone Side */}
          <div className="border border-border rounded-lg p-4 bg-background">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Your Phone</div>
            <div className="space-y-2">
              <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded text-sm">Chat UI</div>
              <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded text-sm">Projects</div>
              <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded text-sm">File Browser</div>
            </div>
          </div>
          
          {/* Desktop Side */}
          <div className="border border-border rounded-lg p-4 bg-background">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Your Desktop</div>
            <div className="space-y-2">
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm">
                <span className="font-medium">Bridge Server</span>
                <span className="text-xs text-muted-foreground ml-2">Port 18274</span>
              </div>
              <div className="text-center text-muted-foreground text-xs">↓</div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm">
                <span className="font-medium">AI Backend</span>
                <span className="text-xs text-muted-foreground ml-2">OpenCode / Claude</span>
              </div>
              <div className="text-center text-muted-foreground text-xs">↓</div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm">Your Code (Filesystem)</div>
              <div className="text-center text-muted-foreground text-xs">↓</div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm">AI Cloud (Anthropic/OpenAI)</div>
            </div>
          </div>
        </div>
        
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Connection Types:</span> Local WiFi (ws://) • Tailscale VPN (ws://) • Tailscale Funnel (wss://)
          </div>
        </div>
      </div>

      <h2 id="component-responsibilities" className="text-2xl font-semibold mb-4 mt-10">Component Responsibilities</h2>
      
      <SimpleTable
        headers={["Component", "Responsibility"]}
        rows={[
          ["Phone App", "User interface, WebSocket client, state management, caching"],
          ["Bridge Server", "WebSocket server, message routing, event batching, health monitoring"],
          ["AI Backend", "Session management, AI reasoning, tool execution, file operations"],
          ["Filesystem", "Your actual code files that the AI reads and modifies"],
        ]}
      />

      <h2 id="data-flow" className="text-2xl font-semibold mb-4 mt-10">Data Flow</h2>
      <p className="text-muted-foreground mb-4">
        When you send a message from your phone:
      </p>

      <div className="bg-muted/30 rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">1</div>
          <div><span className="font-medium">Phone App:</span> <span className="text-muted-foreground">User types &quot;Fix the bug in auth.ts&quot;</span></div>
        </div>
        <div className="ml-3 text-muted-foreground">↓</div>
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">2</div>
          <div><span className="font-medium">WebSocket:</span> <span className="text-muted-foreground font-mono text-xs">type: &quot;chat&quot;, sessionId, content</span></div>
        </div>
        <div className="ml-3 text-muted-foreground">↓</div>
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center shrink-0 mt-0.5">3</div>
          <div><span className="font-medium">Bridge Server:</span> <span className="text-muted-foreground">Receives message, calls AI backend API</span></div>
        </div>
        <div className="ml-3 text-muted-foreground">↓</div>
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center shrink-0 mt-0.5">4</div>
          <div><span className="font-medium">AI Backend:</span> <span className="text-muted-foreground">Processes request, executes tools (Read, Edit, Bash)</span></div>
        </div>
        <div className="ml-3 text-muted-foreground">↓</div>
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center shrink-0 mt-0.5">5</div>
          <div><span className="font-medium">Bridge Server:</span> <span className="text-muted-foreground">Receives events, batches and forwards to phone</span></div>
        </div>
        <div className="ml-3 text-muted-foreground">↓</div>
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center shrink-0 mt-0.5">6</div>
          <div><span className="font-medium">Phone App:</span> <span className="text-muted-foreground">Displays streaming response, tool calls, and results</span></div>
        </div>
      </div>

      <h2 id="connection-types" className="text-2xl font-semibold mb-4 mt-10">Connection Types</h2>
      
      <p className="text-muted-foreground mb-4">
        Broski supports multiple connection methods for different scenarios:
      </p>

      <SimpleTable
        headers={["Type", "Latency", "Security", "Setup", "Use Case"]}
        rows={[
          ["Local WiFi", "1-30ms", "Local network only", "Automatic", "Home/office, fastest"],
          ["Tailscale VPN", "30-100ms", "WireGuard encrypted", "Install app on both", "Remote, secure"],
          ["Tailscale Funnel", "Variable", "TLS 1.3 (HTTPS)", "Enable in admin console", "Public access, no VPN on phone"],
        ]}
      />

      <h2 id="how-it-works" className="text-2xl font-semibold mb-4 mt-10">How It Works</h2>
      
      <Steps
        steps={[
          { title: "Bridge starts", description: "WebSocket server runs on your Mac with a QR code containing connection info" },
          { title: "Phone scans QR", description: "Broski app extracts host, port, and auth token from the QR code payload" },
          { title: "Connection established", description: "Phone connects via WebSocket (local WiFi, Tailscale, or Funnel)" },
          { title: "Messages relay", description: "Your messages go to AI agent, responses and tool calls stream back in real-time" },
        ]}
      />

      <h2 id="agents" className="text-2xl font-semibold mb-4 mt-10">Supported AI Agents</h2>
      
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="flex flex-col items-center p-3 border border-border/40 rounded-lg">
          <Image src="/logos/anthropic.svg" alt="Claude" width={24} height={24} className="mb-2" />
          <span className="text-xs font-medium">Claude Code</span>
          <span className="text-xs text-muted-foreground">Official Anthropic CLI</span>
        </div>
        <div className="flex flex-col items-center p-3 border border-border/40 rounded-lg">
          <Image src="/logos/opencode.svg" alt="OpenCode" width={24} height={24} className="mb-2" />
          <span className="text-xs font-medium">OpenCode</span>
          <span className="text-xs text-muted-foreground">Multi-provider agent</span>
        </div>
        <div className="flex flex-col items-center p-3 border border-border/40 rounded-lg">
          <Image src="/logos/openai.svg" alt="Codex" width={24} height={24} className="mb-2" />
          <span className="text-xs font-medium">Codex</span>
          <span className="text-xs text-muted-foreground">OpenAI models</span>
        </div>
      </div>

      <h2 id="version-requirements" className="text-2xl font-semibold mb-4 mt-10">Version Requirements</h2>
      
      <SimpleTable
        headers={["Component", "Minimum Version", "Recommended"]}
        rows={[

          ["OpenCode", "Latest", "Latest"],
          ["Claude Code CLI", "Latest", "Latest"],
          ["macOS", "12 (Monterey)", "14+ (Sonoma)"],
          ["Windows", "10 (1903+)", "11"],
          ["Linux", "Ubuntu 20.04+", "Ubuntu 22.04+"],
        ]}
      />

      <h2 id="security" className="text-2xl font-semibold mb-4 mt-10">Security</h2>
      
      <Callout type="tip" title="Privacy by Design">
        All traffic stays on your local network or encrypted Tailscale tunnel. No data is sent to 
        Broski servers. Connection secured with a cryptographically random 24-byte token on each start.
      </Callout>

      <SimpleTable
        headers={["Security Feature", "Implementation"]}
        rows={[
          ["Auth Token", "24 bytes (192 bits) cryptographically random, base64url encoded"],
          ["Token Validation", "Timing-safe comparison to prevent timing attacks"],
          ["Token Storage", "~/.broski/token with 0600 permissions (owner read/write only)"],
          ["Local WiFi", "Unencrypted but local-only (trusted network)"],
          ["Tailscale", "WireGuard encryption (military-grade)"],
          ["Funnel", "TLS 1.3 HTTPS (public but encrypted)"],
        ]}
      />

      <h2 id="next" className="text-lg font-semibold mb-4 mt-10">Next Steps</h2>
      <CardGrid>
        <Card href="/docs/bridge/configuration" title="Configuration" description="CLI options, environment variables, and config files" />
        <Card href="/docs/bridge/remote-access" title="Remote Access" description="Set up Tailscale for access from anywhere" />
        <Card href="/docs/bridge/background-service" title="Background Service" description="Run bridge automatically on boot" />
      </CardGrid>
    </article>
  );
}
