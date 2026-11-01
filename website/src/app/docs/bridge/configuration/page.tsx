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
            ["Bridge Loopback Port", "--port", "BROSKI_PORT", "18274"],
            ["Loopback TLS", "--tls / --no-tls", "BROSKI_TLS", "enabled"],
            ["New Local Hook Token", "--new-token", "-", "false"],
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
            <p className="text-muted-foreground text-sm mb-3">Install Broski Link as a background service that runs on login and supervises the bridge.</p>
            <CodeBlock language="bash">{`broski install`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Registers <code>broski-link</code> as a LaunchAgent (macOS) or systemd user service (Linux). Windows is not supported.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-mono font-medium mb-2">broski-link pair</h4>
            <p className="text-muted-foreground text-sm mb-3">Show the QR code to pair your phone (works with the background service).</p>
            <CodeBlock language="bash">{`broski-link pair`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">The code is single-use and expires after 10 minutes.</p>
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
            <h4 className="font-mono font-medium mb-2">broski-link</h4>
            <p className="text-muted-foreground text-sm mb-3">The Broski Link daemon: pairing, devices and link status.</p>
            <CodeBlock language="bash">{`broski-link pair      # show a pairing QR
broski-link status    # bridge, relay and session status
broski-link devices   # list paired phones
broski-link revoke <id prefix>`}</CodeBlock>
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
            <p className="text-muted-foreground text-sm mb-3">Bridge loopback listener port (agent hooks, dashboard, dev-server proxy). Phones do not connect to it.</p>
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
            <h3 className="font-mono font-medium mb-2">--new-token</h3>
            <p className="text-muted-foreground text-sm mb-3">Generate a new local hook token.</p>
            <CodeBlock language="bash">{`broski --new-token`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">Invalidates the token the agent hooks use. It does not affect paired phones. The new token is persisted to ~/.broski/token.json.</p>
          </div>
        </div>
      </section>

      {/* Configuration Files */}
      <section className="mb-12">
        <h2 id="config-files" className="text-2xl font-semibold mb-4">Configuration Files</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">~/.broski/link/config.json</h3>
            <p className="text-muted-foreground text-sm mb-3">Optional settings for the Broski Link service (<code>broski-link</code>).</p>
            <SimpleTable
              headers={["Key", "Type", "Description"]}
              rows={[
                ["relay", "string", "Relay URL, e.g. wss://relay.example.com. Enables the relay route and puts the relay in pairing QR codes"],
                ["lan_port", "number", "Port for direct local-network connections (default 18275)"],
                ["lan", "boolean", "Set to false to turn off direct local-network connections"],
              ]}
            />
            <p className="text-sm text-muted-foreground mt-3">Restart with <code>broski restart</code> after changing it.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">~/.broski/token.json</h3>
            <p className="text-muted-foreground text-sm mb-3">Local bearer token for the bridge&apos;s loopback listener, used by the Claude Code permission hook.</p>
            <SimpleTable
              headers={["Property", "Value"]}
              rows={[
                ["Format", "JSON (version, token, createdAt, lastUsedAt)"],
                ["Permissions", "0600 (owner read/write only)"],
                ["Token", "Base64url random token"],
                ["Created", "Automatically on first run"],
              ]}
            />
            <Callout type="warning" title="Security">
              This file contains the local hook token. Never share it or commit it to version control.
              To invalidate it: run <code>broski --new-token</code>. It is not used for pairing phones.
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
            ["BROSKI_PORT", "number", "18274", "Bridge loopback port"],
            ["BROSKI_TLS", "0 or 1", "1", "TLS on the loopback listener used by agent hooks"],
          ]}
        />

        <h3 className="text-lg font-medium mb-3 mt-6">AI Provider Variables</h3>
        <SimpleTable
          headers={["Variable", "Type", "Description"]}
          rows={[
            ["ANTHROPIC_API_KEY", "string", "Anthropic API key for Claude Code"],
            ["OPENAI_API_KEY", "string", "OpenAI API key for Pi's OpenAI models"],
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
            <p className="text-sm text-muted-foreground mt-2">Uses all defaults: loopback port 18274.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Custom Port</h4>
            <CodeBlock language="bash">{`broski --port 8080`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Pair a Phone</h4>
            <CodeBlock language="bash">{`broski install
broski-link pair`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">Starts Broski Link and shows a QR code for the Broski app.</p>
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
            <h4 className="font-medium mb-2">Relay for Remote Access</h4>
            <CodeBlock language="json">{`// ~/.broski/link/config.json
{
  "relay": "wss://relay.example.com"
}`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">Restart with <code>broski restart</code>, then run <code>broski-link pair</code>.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Custom Loopback Port</h4>
            <CodeBlock language="bash">{`export BROSKI_PORT=18274
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
            ["Agent hooks get 401", "Stale local hook token", "Restart the bridge, or run broski --new-token"],
            ["Claude Code unavailable", "Missing API key", "Set ANTHROPIC_API_KEY or run claude login"],
            ["QR code not scanning", "QR expired or already used", "Run broski-link pair for a new one"],
          ]}
        />
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Next Steps</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access</h3>
            <p className="text-sm text-muted-foreground">How phones reach your Mac, directly or through a relay</p>
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
