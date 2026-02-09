import type { Metadata } from "next";
import { CodeBlock, Callout, SimpleTable } from "@/components/docs";

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

      {/* Configuration Precedence */}
      <section className="mb-12">
        <h2 id="precedence" className="text-2xl font-semibold mb-4">Configuration Precedence</h2>
        <p className="text-muted-foreground mb-4">
          When the same setting is available in multiple places, the following order applies (highest to lowest):
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm mb-4">
          <li><strong>CLI arguments</strong> - Always take precedence</li>
          <li><strong>Environment variables</strong> - Override config files</li>
          <li><strong>Configuration files</strong> - Override defaults</li>
          <li><strong>Default values</strong> - Built-in fallbacks</li>
        </ol>
        <CodeBlock language="bash">{`# CLI overrides env var
BROSKI_PORT=8080 broski --port 9090
# Result: Port 9090 is used`}</CodeBlock>
      </section>

      {/* Quick Reference */}
      <section className="mb-12">
        <h2 id="quick-reference" className="text-2xl font-semibold mb-4">Quick Reference</h2>
        <SimpleTable
          headers={["Setting", "CLI Flag", "Env Variable", "Default"]}
          rows={[
            ["Bridge Port", "--port", "BROSKI_PORT", "18274"],

            ["Tailscale Funnel", "--funnel", "BROSKI_ENABLE_FUNNEL=1", "false"],
            ["New Token", "--new-token", "-", "false"],
            ["Detect Hotspot", "--hotspot", "-", "false"],
            ["OpenCode URL", "--opencode-url", "OPENCODE_BASE_URL", "-"],
            ["OpenCode Hostname", "--opencode-hostname", "BROSKI_OPENCODE_HOSTNAME", "127.0.0.1"],
            ["OpenCode Port", "--opencode-port", "BROSKI_OPENCODE_PORT", "0 (random)"],
          ]}
        />
      </section>

      {/* CLI Options */}
      <section className="mb-12">
        <h2 id="cli-options" className="text-2xl font-semibold mb-4">CLI Options</h2>
        
        <h3 id="subcommands" className="text-xl font-medium mb-3 mt-6">Subcommands</h3>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski (default)</h4>
            <p className="text-muted-foreground text-sm mb-3">Start the bridge server.</p>
            <CodeBlock language="bash">{`broski [options]`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski install</h4>
            <p className="text-muted-foreground text-sm mb-3">Install as a background service that runs on login.</p>
            <CodeBlock language="bash">{`broski install`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Creates a LaunchAgent (macOS) or systemd service (Linux).</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski qr</h4>
            <p className="text-muted-foreground text-sm mb-3">Show the QR code to pair your phone (works with background service).</p>
            <CodeBlock language="bash">{`broski qr
broski qr --hotspot  # Prioritize hotspot IP`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski doctor</h4>
            <p className="text-muted-foreground text-sm mb-3">Run diagnostics, apply safe fixes, and export support bundles.</p>
            <CodeBlock language="bash">{`broski doctor
broski doctor --fix
broski doctor --profile pairing
broski doctor --export`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Profiles: all, network, pairing, agents, daemon, security.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski setup-tailscale</h4>
            <p className="text-muted-foreground text-sm mb-3">Interactive wizard to install and configure Tailscale for remote access.</p>
            <CodeBlock language="bash">{`broski setup-tailscale`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski status / stop / uninstall</h4>
            <p className="text-muted-foreground text-sm mb-3">Manage the background service.</p>
            <CodeBlock language="bash">{`broski status     # Check if running
broski stop       # Stop the service
broski uninstall  # Remove the service`}</CodeBlock>
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
broski --port 8080

# Use random available port
broski --port 0`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--funnel</h3>
            <p className="text-muted-foreground text-sm mb-3">Enable Tailscale Funnel for public HTTPS access.</p>
            <ul className="text-sm space-y-1 mb-3">
              <li><span className="text-muted-foreground">Requires:</span> Tailscale connected, Funnel enabled in admin console</li>
              <li><span className="text-muted-foreground">Env:</span> <code className="bg-muted/50 px-1 rounded">BROSKI_ENABLE_FUNNEL=1</code></li>
            </ul>
            <CodeBlock language="bash">{`broski --funnel`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Creates a public HTTPS URL (e.g., https://machine.tailnet-name.ts.net). No VPN required on phone.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--new-token</h3>
            <p className="text-muted-foreground text-sm mb-3">Generate a new authentication token.</p>
            <CodeBlock language="bash">{`# Generate new token (invalidates old QR codes)
broski --new-token`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Use if you suspect your token has been compromised. New token is persisted to ~/.broski/token.json.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--hotspot</h3>
            <p className="text-muted-foreground text-sm mb-3">Detect and prioritize hotspot IP for mobile tethering.</p>
            <CodeBlock language="bash">{`broski --hotspot
broski qr --hotspot`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Useful when your phone is providing internet to your system via hotspot and you want to connect Broski over that same connection.</p>
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
broski --manual --opencode-url http://localhost:4096

# Via environment variable
OPENCODE_BASE_URL=http://localhost:4096 broski`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">--attach</h3>
            <p className="text-muted-foreground text-sm mb-3">Scan for running OpenCode servers and interactively choose one.</p>
            <CodeBlock language="bash">{`broski --attach`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Scans common ports (4096, 64864-65119, 49152-49407). If multiple found, presents interactive selection menu.</p>
          </div>
        </div>
      </section>

      {/* Configuration Files */}
      <section className="mb-12">
        <h2 id="config-files" className="text-2xl font-semibold mb-4">Configuration Files</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">~/.broski/token.json</h3>
            <p className="text-muted-foreground text-sm mb-3">Persistent authentication state used for QR pairing and manual connection.</p>
            <SimpleTable
              headers={["Property", "Value"]}
              rows={[
                ["Format", "JSON (version, token, createdAt, expiresAt, lastUsedAt)"],
                ["Permissions", "0600 (owner read/write only)"],
                ["Token", "Base64url random token"],
                ["Created", "Automatically on first run"],
              ]}
            />
            <Callout type="warning" title="Security">
              This file contains your auth token. Never share it or commit it to version control.
              To invalidate: run <code>broski --new-token</code> (or <code>broski qr --new-token</code>).
            </Callout>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">~/.broski/custom-tools.json</h3>
            <p className="text-muted-foreground text-sm mb-3">Custom tool definitions for Claude Code.</p>
            <CodeBlock language="json">{`{
  "version": 1,
  "tools": [
    {
      "id": "tool_1234567890_abc123",
      "name": "my_custom_tool",
      "description": "Description of what the tool does",
      "parameters": [
        {
          "name": "input",
          "type": "string",
          "description": "Input parameter",
          "required": true
        }
      ],
      "handler": "http",
      "handlerConfig": {
        "url": "https://api.example.com/endpoint",
        "method": "POST"
      },
      "enabled": true
    }
  ]
}`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">~/.claude/settings.json</h3>
            <p className="text-muted-foreground text-sm mb-3">Claude CLI authentication (managed by <code>claude login</code>).</p>
            <p className="text-sm text-muted-foreground">Broski checks this file if <code>ANTHROPIC_API_KEY</code> is not set.</p>
          </div>
        </div>
      </section>

      {/* Environment Variables */}
      <section className="mb-12">
        <h2 id="env-vars" className="text-2xl font-semibold mb-4">Environment Variables</h2>
        
        <h3 className="text-lg font-medium mb-3">Bridge Variables</h3>
        <SimpleTable
          headers={["Variable", "Type", "Default", "Description"]}
          rows={[
            ["BROSKI_PORT", "number", "18274", "Bridge WebSocket port"],
            ["BROSKI_ENABLE_FUNNEL", "1 or unset", "unset", "Enable Tailscale Funnel"],
          ]}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">OpenCode Variables</h3>
        <SimpleTable
          headers={["Variable", "Type", "Default", "Description"]}
          rows={[
            ["OPENCODE_BASE_URL", "string", "-", "URL of existing OpenCode server"],
            ["BROSKI_OPENCODE_HOSTNAME", "string", "127.0.0.1", "Hostname for managed OpenCode"],
            ["BROSKI_OPENCODE_PORT", "number", "0", "Port for managed OpenCode (0 = random)"],
          ]}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">AI Provider Variables</h3>
        <SimpleTable
          headers={["Variable", "Type", "Description"]}
          rows={[
            ["ANTHROPIC_API_KEY", "string", "Anthropic API key for Claude Code"],
            ["OPENAI_API_KEY", "string", "OpenAI API key for Codex/GPT models"],
          ]}
        />
      </section>

      {/* Examples */}
      <section className="mb-12">
        <h2 id="examples" className="text-2xl font-semibold mb-4">Configuration Examples</h2>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Minimal Setup</h4>
            <CodeBlock language="bash">{`broski`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">Uses all defaults: port 18274, managed OpenCode, no funnel.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Custom Port</h4>
            <CodeBlock language="bash">{`broski --port 8080`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Tailscale with Funnel</h4>
            <CodeBlock language="bash">{`broski --funnel`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">Public HTTPS access via Tailscale Funnel.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Manual OpenCode Connection</h4>
            <CodeBlock language="bash">{`# Start OpenCode separately
opencode serve --port 4096

# Connect Broski to it
broski --opencode-url http://localhost:4096`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Claude Code Backend</h4>
            <CodeBlock language="bash">{`# With API key
export ANTHROPIC_API_KEY=sk-ant-api03-...
broski

# Or with Claude login
claude login
broski`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Mobile Hotspot</h4>
            <CodeBlock language="bash">{`# When your phone provides internet to your system
broski --hotspot`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Production Setup with Environment</h4>
            <CodeBlock language="bash">{`export BROSKI_PORT=18274
export BROSKI_ENABLE_FUNNEL=1
broski`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Common Mistakes */}
      <section className="mb-12">
        <h2 id="common-mistakes" className="text-2xl font-semibold mb-4">Common Configuration Mistakes</h2>
        
        <SimpleTable
          headers={["Issue", "Cause", "Fix"]}
          rows={[
            ["Port in use", "Another broski or process running", "Kill process or use --port 0"],
            ["Connection refused", "Wrong OpenCode URL", "Check URL with curl <url>/path"],
            ["Auth failed", "Invalid or old token", "Use --new-token to regenerate"],
            ["Funnel failed", "Not enabled in admin console", "Enable at login.tailscale.com/admin"],
            ["Claude Code unavailable", "Missing API key", "Set ANTHROPIC_API_KEY or run claude login"],
            ["QR code not scanning", "Old QR after restart", "Rescan the current QR code"],
          ]}
        />
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
