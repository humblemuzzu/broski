import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Configuration - Broski",
  description: "Complete reference for all CLI options, environment variables, and configuration files",
};

export default function ConfigurationPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="configuration" className="text-4xl font-bold mb-4">Configuration</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Complete reference for all CLI options, environment variables, and configuration files.
      </p>

      {/* Quick Reference */}
      <section className="mb-12">
        <h2 id="quick-reference" className="text-2xl font-semibold mb-4">Quick Reference</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Setting</th>
                <th className="text-left p-3 border-b border-border">CLI Flag</th>
                <th className="text-left p-3 border-b border-border">Env Variable</th>
                <th className="text-left p-3 border-b border-border">Default</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50">Bridge Port</td>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--port</td>
                <td className="p-3 border-b border-border/50 font-mono text-xs">BROSKI_PORT</td>
                <td className="p-3 border-b border-border/50">18274</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">Verbose Mode</td>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--verbose, -v</td>
                <td className="p-3 border-b border-border/50 font-mono text-xs">BROSKI_VERBOSE=1</td>
                <td className="p-3 border-b border-border/50">false</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">Tailscale Funnel</td>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--funnel</td>
                <td className="p-3 border-b border-border/50 font-mono text-xs">BROSKI_ENABLE_FUNNEL=1</td>
                <td className="p-3 border-b border-border/50">false</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">New Token</td>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--new-token</td>
                <td className="p-3 border-b border-border/50">-</td>
                <td className="p-3 border-b border-border/50">false</td>
              </tr>
              <tr>
                <td className="p-3">OpenCode URL</td>
                <td className="p-3 font-mono text-xs">--opencode-url</td>
                <td className="p-3 font-mono text-xs">OPENCODE_BASE_URL</td>
                <td className="p-3">-</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* CLI Options */}
      <section className="mb-12">
        <h2 id="cli-options" className="text-2xl font-semibold mb-4">CLI Options</h2>
        
        <h3 id="subcommands" className="text-xl font-medium mb-3 mt-6">Subcommands</h3>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski (default)</h4>
            <p className="text-muted-foreground text-sm mb-3">Start the bridge server.</p>
            <CodeBlock language="bash">{`bunx broski [options]`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski doctor</h4>
            <p className="text-muted-foreground text-sm mb-3">Check system requirements and diagnose issues.</p>
            <CodeBlock language="bash">{`bunx broski doctor`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Checks: Bun installation, OpenCode installation, network IP, port availability, Tailscale status.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski setup-tailscale</h4>
            <p className="text-muted-foreground text-sm mb-3">Interactive wizard to install and configure Tailscale for remote access.</p>
            <CodeBlock language="bash">{`bunx broski setup-tailscale`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Connection Options */}
      <section className="mb-12">
        <h2 id="connection-options" className="text-2xl font-semibold mb-4">Connection Options</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--port &lt;number&gt;</h3>
            <p className="text-muted-foreground text-sm mb-3">Bridge WebSocket port number.</p>
            <ul className="text-sm space-y-1 mb-3">
              <li><span className="text-muted-foreground">Default:</span> <code className="bg-muted/50 px-1 rounded">18274</code></li>
              <li><span className="text-muted-foreground">Env:</span> <code className="bg-muted/50 px-1 rounded">BROSKI_PORT</code></li>
              <li><span className="text-muted-foreground">Special:</span> <code className="bg-muted/50 px-1 rounded">0</code> = random free port</li>
            </ul>
            <CodeBlock language="bash">{`# Use custom port
bunx broski --port 8080

# Use random available port
bunx broski --port 0`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--funnel</h3>
            <p className="text-muted-foreground text-sm mb-3">Enable Tailscale Funnel for public HTTPS access.</p>
            <ul className="text-sm space-y-1 mb-3">
              <li><span className="text-muted-foreground">Requires:</span> Tailscale connected, Funnel enabled in admin console</li>
              <li><span className="text-muted-foreground">Env:</span> <code className="bg-muted/50 px-1 rounded">BROSKI_ENABLE_FUNNEL=1</code></li>
            </ul>
            <CodeBlock language="bash">{`bunx broski --funnel`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Creates a public HTTPS URL (e.g., https://machine.tailnet-name.ts.net). No VPN required on phone.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--new-token</h3>
            <p className="text-muted-foreground text-sm mb-3">Generate a new authentication token.</p>
            <CodeBlock language="bash">{`# Generate new token (invalidates old QR codes)
bunx broski --new-token`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Use if you suspect your token has been compromised. New token is persisted to ~/.broski/token.</p>
          </div>
        </div>
      </section>

      {/* OpenCode Mode Options */}
      <section className="mb-12">
        <h2 id="opencode-modes" className="text-2xl font-semibold mb-4">OpenCode Mode Options</h2>
        <p className="text-muted-foreground mb-4">Broski can connect to OpenCode in three modes:</p>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--managed (default)</h3>
            <p className="text-muted-foreground text-sm mb-3">Let Broski start and manage an OpenCode server.</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>Broski starts OpenCode on a random port</li>
              <li>Automatically restarts if OpenCode crashes</li>
              <li>OpenCode stops when Broski stops</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--manual</h3>
            <p className="text-muted-foreground text-sm mb-3">Connect to an existing OpenCode server (requires URL).</p>
            <CodeBlock language="bash">{`# Manual mode with explicit URL
bunx broski --manual --opencode-url http://localhost:4096

# Via environment variable
OPENCODE_BASE_URL=http://localhost:4096 bunx broski`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--attach</h3>
            <p className="text-muted-foreground text-sm mb-3">Scan for running OpenCode servers and interactively choose one.</p>
            <CodeBlock language="bash">{`bunx broski --attach`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Scans common ports. If multiple found, presents interactive selection menu.</p>
          </div>
        </div>
      </section>

      {/* Configuration Files */}
      <section className="mb-12">
        <h2 id="config-files" className="text-2xl font-semibold mb-4">Configuration Files</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">~/.broski/token</h3>
            <p className="text-muted-foreground text-sm mb-3">Persistent authentication token for QR code scanning.</p>
            <ul className="text-sm space-y-1">
              <li><span className="text-muted-foreground">Format:</span> Plain text, base64url encoded</li>
              <li><span className="text-muted-foreground">Permissions:</span> 0600 (owner read/write only)</li>
              <li><span className="text-muted-foreground">Length:</span> 24 bytes (32 characters encoded)</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">~/.broski/artifacts-config.json</h3>
            <p className="text-muted-foreground text-sm mb-3">Artifact indexing and enrichment configuration.</p>
            <CodeBlock language="json">{`{
  "indexingEnabled": true,
  "maxContentChars": 250000,
  "enrichment": {
    "provider": "off",
    "enabled": false,
    "batchSize": 5
  }
}`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Configuration Precedence */}
      <section className="mb-12">
        <h2 id="precedence" className="text-2xl font-semibold mb-4">Configuration Precedence</h2>
        <p className="text-muted-foreground mb-4">When the same setting is available in multiple places (highest to lowest):</p>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li><strong>CLI arguments</strong> - Always take precedence</li>
          <li><strong>Environment variables</strong> - Override config files</li>
          <li><strong>Configuration files</strong> - Override defaults</li>
          <li><strong>Default values</strong> - Built-in fallbacks</li>
        </ol>
        <CodeBlock language="bash">{`# CLI overrides env var
BROSKI_PORT=8080 bunx broski --port 9090
# Result: Port 9090 is used`}</CodeBlock>
      </section>

      {/* Examples */}
      <section className="mb-12">
        <h2 id="examples" className="text-2xl font-semibold mb-4">Configuration Examples</h2>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Minimal Setup</h4>
            <CodeBlock language="bash">{`bunx broski`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">Uses all defaults: port 18274, managed OpenCode, no funnel.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Tailscale with Funnel</h4>
            <CodeBlock language="bash">{`bunx broski --funnel --verbose`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Manual OpenCode Connection</h4>
            <CodeBlock language="bash">{`# Start OpenCode separately
opencode serve --port 4096

# Connect Broski
bunx broski --opencode-url http://localhost:4096`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Next Steps</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access</h3>
            <p className="text-sm text-muted-foreground">Set up Tailscale for access from anywhere</p>
          </a>
          <a href="/docs/bridge/background-service" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Background Service</h3>
            <p className="text-sm text-muted-foreground">Run the bridge as a persistent daemon</p>
          </a>
        </div>
      </section>
    </article>
  );
}
