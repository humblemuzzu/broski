import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Error Reference - Broski",
  description: "Complete reference of all error messages in Broski with causes and solutions",
};

export default function ErrorsPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="error-reference" className="text-4xl font-bold mb-4">Error Reference</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Complete reference of all error messages in Broski with causes and solutions.
      </p>

      {/* Quick Reference Table */}
      <section className="mb-12">
        <h2 id="quick-reference" className="text-2xl font-semibold mb-4">Quick Reference</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Error</th>
                <th className="text-left p-3 border-b border-border">Quick Fix</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50">Unauthorized</td>
                <td className="p-3 border-b border-border/50">Re-scan QR code</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">Port in use</td>
                <td className="p-3 border-b border-border/50"><code className="bg-muted/50 px-1 rounded text-xs">kill &lt;PID&gt;</code> or <code className="bg-muted/50 px-1 rounded text-xs">--port 0</code></td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">OpenCode not found</td>
                <td className="p-3 border-b border-border/50"><code className="bg-muted/50 px-1 rounded text-xs">bun install -g opencode</code></td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">Claude Code auth missing</td>
                <td className="p-3 border-b border-border/50"><code className="bg-muted/50 px-1 rounded text-xs">claude login</code> or set API key</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">Connection timeout</td>
                <td className="p-3 border-b border-border/50">Check IP/port, firewall</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50">Access denied</td>
                <td className="p-3 border-b border-border/50">Use paths under ~ or /tmp</td>
              </tr>
              <tr>
                <td className="p-3">Rate limited (429)</td>
                <td className="p-3">Wait 1 minute, retry</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Bridge Startup Errors */}
      <section className="mb-12">
        <h2 id="bridge-startup" className="text-2xl font-semibold mb-4">Bridge Startup Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">&quot;Bridge port {`{port}`} is already in use&quot;</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Another process is using the port. Often a previous bridge instance.
            </p>
            <CodeBlock language="bash">{`# Find the process
lsof -nP -iTCP:18274 -sTCP:LISTEN

# Kill it
kill <PID>

# Or use random port
bunx broski --port 0`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">&quot;Failed to start managed OpenCode server&quot;</h3>
            <p className="text-sm text-muted-foreground mb-3">
              OpenCode or Bun is not installed or not in PATH.
            </p>
            <CodeBlock language="bash">{`# Verify installations
which opencode && opencode --version
which bun && bun --version

# Install if missing
curl -fsSL https://bun.sh/install | bash
bun install -g opencode`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Connection Errors */}
      <section className="mb-12">
        <h2 id="connection-errors" className="text-2xl font-semibold mb-4">Connection Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">&quot;Unauthorized&quot;</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Invalid or missing authentication token. QR code may be outdated.
            </p>
            <p className="text-sm"><strong>Solution:</strong> Re-scan the QR code from the bridge terminal.</p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">&quot;Connection timeout&quot;</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Connection didn&apos;t complete within 5 seconds. Bridge may not be running or network issue.
            </p>
            <CodeBlock language="bash">{`# Verify bridge is running
curl http://<ip>:18274/

# Check firewall isn't blocking
# Ensure same WiFi network (for local)`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">&quot;Heartbeat timeout&quot;</h3>
            <p className="text-sm text-muted-foreground">
              Server didn&apos;t receive a response within 90 seconds. Network dropped or app backgrounded.
              The app will automatically attempt to reconnect.
            </p>
          </div>
        </div>
      </section>

      {/* HTTP Status Codes */}
      <section className="mb-12">
        <h2 id="http-codes" className="text-2xl font-semibold mb-4">HTTP Status Codes</h2>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Code</th>
                <th className="text-left p-3 border-b border-border">Meaning</th>
                <th className="text-left p-3 border-b border-border">Solution</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono">400</td>
                <td className="p-3 border-b border-border/50">Bad Request</td>
                <td className="p-3 border-b border-border/50">Check request format</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono">401</td>
                <td className="p-3 border-b border-border/50">Unauthorized</td>
                <td className="p-3 border-b border-border/50">Re-scan QR code</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono">403</td>
                <td className="p-3 border-b border-border/50">Forbidden</td>
                <td className="p-3 border-b border-border/50">Check path restrictions</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono">404</td>
                <td className="p-3 border-b border-border/50">Not Found</td>
                <td className="p-3 border-b border-border/50">Verify resource exists</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono">429</td>
                <td className="p-3 border-b border-border/50">Rate Limited</td>
                <td className="p-3 border-b border-border/50">Wait 1 minute, check API limits</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono">500</td>
                <td className="p-3 border-b border-border/50">Server Error</td>
                <td className="p-3 border-b border-border/50">Check logs, restart bridge</td>
              </tr>
              <tr>
                <td className="p-3 font-mono">502</td>
                <td className="p-3">Bad Gateway</td>
                <td className="p-3">Backend unavailable, restart</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Getting Help */}
      <section className="mb-12">
        <h2 id="getting-help" className="text-2xl font-semibold mb-4">Getting Help</h2>
        <p className="text-muted-foreground mb-4">If you can&apos;t find your error:</p>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>Run <code className="bg-muted/50 px-1 rounded">bunx broski --verbose</code> for detailed logs</li>
          <li>Run <code className="bg-muted/50 px-1 rounded">bunx broski doctor</code> for diagnostics</li>
          <li>Check the <a href="/docs/troubleshooting" className="text-primary hover:underline">troubleshooting guide</a></li>
          <li>Contact support at <a href="mailto:broskiappp@gmail.com" className="text-primary hover:underline">broskiappp@gmail.com</a></li>
        </ol>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/troubleshooting" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Troubleshooting</h3>
            <p className="text-sm text-muted-foreground">Step-by-step problem solving</p>
          </a>
          <a href="/docs/bridge/configuration" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Configuration</h3>
            <p className="text-sm text-muted-foreground">All configuration options</p>
          </a>
        </div>
      </section>
    </article>
  );
}
