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
        The Broski Bridge is a lightweight server that runs on your Mac or Linux machine 
        and acts as the communication hub between your phone and the AI coding agent. It sits behind 
        <code> broski-link</code>, which handles pairing and the encrypted connection to your phone. The bridge:
      </p>
      <ul className="list-disc list-inside space-y-2 text-muted-foreground mb-6">
        <li><strong className="text-foreground">Translates protocols</strong> - Converts messages from your phone into API calls to the AI backend</li>
        <li><strong className="text-foreground">Stays private</strong> - Listens on a local socket and on loopback only; it is never exposed to your network</li>
      </ul>

      <h2 id="install" className="text-2xl font-semibold mb-4 mt-10">Installation</h2>
      
      <CodeBlock language="bash">{`broski install`}</CodeBlock>

      <Callout type="info" title="Verify your setup">
        Run <code>broski doctor</code> to check that everything is configured correctly.
      </Callout>

      <h2 id="commands" className="text-2xl font-semibold mb-4 mt-10">Commands</h2>
      
      <CodeBlock language="bash">{`broski                 # Start server (default)
broski install         # Install as background service
broski uninstall       # Remove background service
broski status          # Check if bridge is running
broski stop            # Stop background service
broski-link pair       # Show QR code to pair phone
broski-link status     # Bridge, relay and session status
broski doctor          # Full diagnostics
broski doctor --fix    # Apply safe fixes
broski logs --export   # Export diagnostics bundle`}</CodeBlock>

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
                <span className="font-medium">broski-link</span>
                <span className="text-xs text-muted-foreground ml-2">Pairing, encryption</span>
              </div>
              <div className="text-center text-muted-foreground text-xs">↓</div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm">
                <span className="font-medium">Bridge Server</span>
                <span className="text-xs text-muted-foreground ml-2">Unix socket</span>
              </div>
              <div className="text-center text-muted-foreground text-xs">↓</div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm">
                <span className="font-medium">AI Backend</span>
                <span className="text-xs text-muted-foreground ml-2">Claude Code / Pi</span>
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
            <span className="font-medium text-foreground">Connection Routes:</span> Local network (direct) • Relay (end-to-end encrypted)
          </div>
        </div>
      </div>

      <h2 id="component-responsibilities" className="text-2xl font-semibold mb-4 mt-10">Component Responsibilities</h2>
      
      <SimpleTable
        headers={["Component", "Responsibility"]}
        rows={[
          ["Phone App", "User interface, Broski Link client, state management, caching"],
          ["broski-link", "Pairing, device authorisation, Noise encryption, LAN listener, relay client, bridge supervision"],
          ["Bridge Server", "Message routing, event batching, agent connectors"],
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

      <h2 id="connection-types" className="text-2xl font-semibold mb-4 mt-10">Connection Routes</h2>
      
      <p className="text-muted-foreground mb-4">
        Broski Link picks the route that works:
      </p>

      <SimpleTable
        headers={["Route", "Latency", "Security", "Setup", "Use Case"]}
        rows={[
          ["Local network", "1-30ms", "Noise end-to-end", "Automatic", "Home/office, fastest"],
          ["Relay", "Variable", "Noise end-to-end", "Set a relay in ~/.broski/link/config.json", "Away from home"],
        ]}
      />

      <h2 id="how-it-works" className="text-2xl font-semibold mb-4 mt-10">How It Works</h2>
      
      <Steps
        steps={[
          { title: "Service starts", description: "broski-link runs on your system, starts the bridge and listens for paired phones" },
          { title: "Phone scans QR", description: "broski-link pair shows a QR code with your Mac's fingerprint, a one-time pairing secret and its local and relay addresses" },
          { title: "Encrypted link established", description: "The phone connects directly on your network, or through a relay, and completes a Noise handshake" },
          { title: "Messages relay", description: "Your messages go to AI agent, responses and tool calls stream back in real-time" },
        ]}
      />

      <h2 id="agents" className="text-2xl font-semibold mb-4 mt-10">Supported AI Agents</h2>
      
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="flex flex-col items-center p-3 border border-border/40 rounded-lg">
          <Image src="/logos/anthropic.svg" alt="Claude" width={24} height={24} className="mb-2" />
          <span className="text-xs font-medium">Claude Code</span>
          <span className="text-xs text-muted-foreground">Official Anthropic CLI</span>
        </div>
        <div className="flex flex-col items-center p-3 border border-border/40 rounded-lg">
          <Image src="/logos/pi.svg" alt="Pi" width={24} height={24} className="mb-2" />
          <span className="text-xs font-medium">Pi</span>
          <span className="text-xs text-muted-foreground">Multi-provider agent</span>
        </div>
      </div>

      <h2 id="version-requirements" className="text-2xl font-semibold mb-4 mt-10">Version Requirements</h2>
      
      <SimpleTable
        headers={["Component", "Minimum Version", "Recommended"]}
        rows={[
          ["Claude Code CLI", "Latest", "Latest"],
          ["Pi", "Latest", "Latest"],
          ["macOS", "12 (Monterey)", "14+ (Sonoma)"],
          ["Linux", "Ubuntu 20.04+", "Ubuntu 22.04+"],
        ]}
      />

      <h2 id="security" className="text-2xl font-semibold mb-4 mt-10">Security</h2>
      
      <Callout type="tip" title="Privacy by Design">
        Traffic between your phone and your Mac is end-to-end encrypted, on your local network and through a relay.
        No data is sent to Broski servers, and the bridge itself is never exposed to the network.
      </Callout>

      <SimpleTable
        headers={["Security Feature", "Implementation"]}
        rows={[
          ["Pairing", "One-time secret in the QR code; expires after 10 minutes and works once"],
          ["Link Encryption", "Noise end-to-end (hybrid X25519 + ML-KEM-768), pinned to your Mac's fingerprint"],
          ["Device Control", "broski-link devices / revoke manage which phones may connect"],
          ["Bridge Exposure", "Unix socket for broski-link and 127.0.0.1 only (agent hooks, dashboard)"],
          ["Local Hook Token", "Random token with timing-safe comparison, stored in ~/.broski/token.json with 0600 permissions"],
          ["Relay", "Forwards ciphertext only; sees ids, timing and sizes"],
        ]}
      />

      <h2 id="next" className="text-lg font-semibold mb-4 mt-10">Next Steps</h2>
      <CardGrid>
        <Card href="/docs/bridge/configuration" title="Configuration" description="CLI options, environment variables, and config files" />
        <Card href="/docs/bridge/remote-access" title="Remote Access" description="How phones reach your Mac, directly or through a relay" />
        <Card href="/docs/bridge/background-service" title="Background Service" description="Run bridge automatically on boot" />
      </CardGrid>
    </article>
  );
}
