import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";

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

      {/* How to Use */}
      <section className="mb-12">
        <h2 id="how-to-use" className="text-2xl font-semibold mb-4">How to Use This Reference</h2>
        <ul className="text-muted-foreground space-y-2">
          <li>• <strong>Search the page:</strong> Use Ctrl+F (or Cmd+F on Mac) to search for the exact error text</li>
          <li>• <strong>Browse by category:</strong> Errors are organized by component</li>
          <li>• <strong>Check the quick reference:</strong> Jump to common errors at a glance</li>
        </ul>
      </section>

      {/* Quick Reference Table */}
      <section className="mb-12">
        <h2 id="quick-reference" className="text-2xl font-semibold mb-4">Quick Reference</h2>
        <SimpleTable
          headers={["Error/Code", "Component", "Quick Fix"]}
          rows={[
            ["Old Broski QR", "Pairing", "Update broski on your Mac, then run broski-link pair"],
            ["Port in use", "Bridge", <><code className="text-xs">kill &lt;PID&gt;</code> or <code className="text-xs">--port 0</code></>],
            ["OpenCode not found", "OpenCode", <code key="oc" className="text-xs">bun add -g opencode-ai</code>],

            ["Claude Code auth missing", "Claude Code", <><code key="cc" className="text-xs">export ANTHROPIC_API_KEY=...</code> or <code className="text-xs">claude login</code></>],
            ["Offline or Asleep", "Link", "Wake the Mac; check broski-link status"],
            ["Pairing QR expired", "Pairing", "Run broski-link pair and scan the new code"],
            ["Access denied", "Files", "Use paths under ~ or /tmp"],
            ["Rate limited (429)", "API", "Wait 1 minute, retry"],
            ["OAuth token expired", "Auth", <><code key="login" className="text-xs">claude login</code> or <code className="text-xs">codex</code></>],

            ["Scan timeout", "File Search", "Informational, cached results used"],
          ]}
        />
      </section>

      {/* Bridge Startup Errors */}
      <section className="mb-12">
        <h2 id="bridge-startup" className="text-2xl font-semibold mb-4">Bridge Startup Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Bridge port {`{port}`} is already in use&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Bridge startup
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> Another process (often a previous broski instance) is using the port. 
              This commonly happens when a previous bridge was suspended with Ctrl+Z instead of Ctrl+C.
            </p>
            <CodeBlock language="bash">{`# Find the process using the port
lsof -nP -iTCP:18274 -sTCP:LISTEN

# Kill it
kill <PID>

# Or use random port
broski --port 0`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Failed to start managed OpenCode server&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> OpenCode bootstrap
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> OpenCode is not installed or not in PATH.
            </p>
            <CodeBlock language="bash">{`# Verify installation
which opencode && opencode --version

# Install if missing
bun add -g opencode-ai`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;OpenCode started but did not become ready&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> OpenCode health check
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> OpenCode process started but HTTP server didn&apos;t respond within 10 seconds.
            </p>
            <CodeBlock language="bash">{`# Try running OpenCode manually to see errors
opencode serve

# Try manual mode
broski --manual --opencode-url http://localhost:4096`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;No running OpenCode servers found&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Attach mode
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> You used <code>--attach</code> but no running OpenCode instances were detected.
            </p>
            <CodeBlock language="bash">{`# Start OpenCode manually first
opencode serve

# Or use managed mode (default)
broski`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Manual mode requires --opencode-url&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> CLI validation
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> You specified <code>--manual</code> without providing the OpenCode server URL.
            </p>
            <CodeBlock language="bash">{`broski --manual --opencode-url http://localhost:4096

# Or via environment variable
OPENCODE_BASE_URL=http://localhost:4096 broski --manual`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Connection Errors */}
      <section className="mb-12">
        <h2 id="connection-errors" className="text-2xl font-semibold mb-4">Connection Errors</h2>

        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;The machine did not answer. Check that it is running and that this phone can reach it.&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Pairing
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> None of the addresses in the QR answered within 1.5 seconds. The Mac may be asleep, broski-link may
              not be running, or the phone is on a different network.
            </p>
            <CodeBlock language="bash">{`broski status
broski-link status`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;This QR code has no address to reach the machine at.&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Pairing
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> The QR carries neither a local address nor a relay. Your Mac has no reachable network address and no relay configured.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Solution:</strong> Connect the Mac to a network, or configure a relay in <code>~/.broski/link/config.json</code>, then run <code>broski-link pair</code>.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;The machine did not confirm the pairing in time.&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Pairing
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Solution:</strong> Check <code>broski-link status</code>, then run <code>broski-link pair</code> and try again.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;The machine closed the connection before confirming the pairing.&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Pairing
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> The pairing secret was wrong or already used, or the QR was replaced by a newer one.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Solution:</strong> Run <code>broski-link pair</code> once and scan that code.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">Machine shows as Asleep or Offline</div>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> The Mac is asleep, off, or cannot reach the relay and the phone cannot reach it directly.
            </p>
            <CodeBlock language="bash">{`# On the Mac
broski-link status
broski logs --follow`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Pairing Errors */}
      <section className="mb-12">
        <h2 id="auth-errors" className="text-2xl font-semibold mb-4">Pairing Errors</h2>

        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;the pairing QR expired at ...&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Pairing QR check
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> A pairing QR works for 10 minutes and only once.
            </p>
            <CodeBlock language="bash">{`broski-link pair`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;This is an old Broski QR — update broski on your Mac and scan the new code.&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Scan screen
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> The QR was made by a version of broski from before Broski Link.
            </p>
            <CodeBlock language="bash">{`broski update
broski install
broski-link pair`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;This QR code is not a Broski pairing code.&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Scan screen
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> The scanned code is not a <code>broski://pair</code> link.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Solution:</strong> Scan the code that <code>broski-link pair</code> prints.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;That machine is not the one this QR code pairs with.&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Pairing
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> The address in the QR answered, but the machine&apos;s fingerprint does not match the one in the QR.
              This protects you from pairing with the wrong machine.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Solution:</strong> Run <code>broski-link pair</code> on the machine you want and scan that code.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">Pairing refused</div>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> A machine pairs with at most 32 devices.
            </p>
            <CodeBlock language="bash">{`broski-link devices
broski-link revoke <device id prefix>`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* OpenCode Errors */}
      <section className="mb-12">
        <h2 id="opencode-errors" className="text-2xl font-semibold mb-4">OpenCode Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;OpenCode not found&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Doctor check
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> OpenCode is not installed or not in your PATH.
            </p>
            <CodeBlock language="bash">{`# Install OpenCode
bun add -g opencode-ai

# Reload shell
source ~/.bashrc  # or ~/.zshrc`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;OpenCode not responding&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Health check
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> OpenCode process is running but not responding to HTTP requests.
            </p>
            <CodeBlock language="bash">{`# Restart bridge (it will restart OpenCode)
# Press Ctrl+C, then:
broski

# Or test OpenCode directly
opencode serve`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Claude Code Errors */}
      <section className="mb-12">
        <h2 id="claude-code-errors" className="text-2xl font-semibold mb-4">Claude Code Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Claude Code auth not configured&quot; / &quot;cc_auth_missing&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Claude Code initialization
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> No valid Anthropic authentication found.
            </p>
            <CodeBlock language="bash">{`# Option 1: Set API Key
export ANTHROPIC_API_KEY=sk-ant-...
broski

# Option 2: Login via Claude CLI
claude login`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;cc_error&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Claude Code streaming
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> General error during Claude Code execution. Check the accompanying message for details.
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Rate limiting: Wait and retry</li>
              <li>Context too long: Start a new session</li>
              <li>Network issues: Check internet connection</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-amber-400">&quot;User denied permission&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> Claude Code permission handling
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> User rejected a tool permission request in the app.
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>Note:</strong> This is intentional user action. If you want to allow the action, tap &quot;Allow&quot; instead of &quot;Deny&quot;.
            </p>
          </div>
        </div>
      </section>

      {/* Relay Errors */}
      <section className="mb-12">
        <h2 id="relay-errors" className="text-2xl font-semibold mb-4">Relay Errors</h2>

        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-amber-400">Relay not connected</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> <code>broski-link status</code>
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> The relay URL in <code>~/.broski/link/config.json</code> is wrong or unreachable, or no relay is configured.
            </p>
            <CodeBlock language="bash">{`# Check the relay state
broski-link status

# Fix the URL, then restart
broski restart`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* PTY (Terminal) Errors */}
      <section className="mb-12">
        <h2 id="pty-errors" className="text-2xl font-semibold mb-4">PTY (Terminal) Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;PTY list failed&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Failed to list terminal sessions from OpenCode. Verify OpenCode is running and restart the bridge.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Failed to create PTY session&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              OpenCode failed to create a new terminal session. Check OpenCode logs and verify the project path exists.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;PTY session not found&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              The requested PTY session ID doesn&apos;t exist (may have been deleted). Refresh the terminal list or create a new session.
            </p>
          </div>
        </div>
      </section>

      {/* File Access Errors */}
      <section className="mb-12">
        <h2 id="file-errors" className="text-2xl font-semibold mb-4">File Access Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Access denied&quot;</div>
            <p className="text-sm text-muted-foreground mb-2">
              <strong>Source:</strong> File operations
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              <strong>Cause:</strong> Requested file path is outside allowed directories. For security, Broski only allows access to:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Home directory (~)</li>
              <li>/tmp</li>
              <li>/var/tmp</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;File not found&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              The requested file doesn&apos;t exist at the specified path. Verify the path is correct and file permissions.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;File too large&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              File exceeds size limit (default 10MB for binary files). Use terminal commands for large files instead.
            </p>
          </div>
        </div>
      </section>

      {/* HTTP Status Codes */}
      <section className="mb-12">
        <h2 id="http-codes" className="text-2xl font-semibold mb-4">HTTP Status Codes</h2>
        
        <h3 id="client-errors" className="text-lg font-semibold mb-3">Client Errors (4xx)</h3>
        <SimpleTable
          headers={["Code", "Meaning", "Solution"]}
          rows={[
            ["400", "Bad Request", "Check request format and required parameters"],
            ["401", "Unauthorized", "The local bearer token was missing or wrong (agent hooks and the dashboard use it). Restart the bridge to reload it"],
            ["403", "Forbidden", "Check permissions and path restrictions"],
            ["404", "Not Found", "Verify resource ID or path is correct"],
            ["429", "Too Many Requests", "Wait for rate limit to reset (usually 1 minute)"],
          ]}
        />

        <h3 id="server-errors" className="text-lg font-semibold mt-6 mb-3">Server Errors (5xx)</h3>
        <SimpleTable
          headers={["Code", "Meaning", "Solution"]}
          rows={[
            ["500", "Internal Server Error", "Check bridge logs, restart bridge"],
            ["502", "Bad Gateway", "Backend (OpenCode/Claude) unavailable, restart bridge"],
            ["503", "Service Unavailable", "Wait and retry, or restart bridge"],
          ]}
        />
      </section>

      {/* Plugin Errors */}
      <section className="mb-12">
        <h2 id="plugin-errors" className="text-2xl font-semibold mb-4">Plugin Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-amber-400">&quot;Error scanning plugins directory&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Failed to read plugins from <code>~/.claude/plugins/</code>. Check directory permissions or remove corrupted plugin directories.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-amber-400">&quot;Failed to save plugin config&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Could not write to <code>~/.broski/plugins-config.json</code>. Check disk space and directory permissions.
            </p>
          </div>
        </div>
      </section>

      {/* Custom Tools Errors */}
      <section className="mb-12">
        <h2 id="custom-tools-errors" className="text-2xl font-semibold mb-4">Custom Tools Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Error executing HTTP tool&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              A custom HTTP tool failed. Check that target URL is reachable, authentication headers are correct, 
              and API endpoint is operational.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Error executing script&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              A custom script tool failed. Verify script path exists, is executable, and test manually:
            </p>
            <CodeBlock language="bash">{`/path/to/your/script args`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Unknown handler type&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Custom tool has unrecognized handler type. Must be <code>http</code>, <code>script</code>, or <code>builtin</code>.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Invalid tool: {`{errors}`}&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Custom tool definition failed validation. Check for required fields (name, description, command), 
              valid parameter types, and correct JSON schema format.
            </p>
          </div>
        </div>
      </section>

      {/* File Search Errors */}
      <section className="mb-12">
        <h2 id="file-search-errors" className="text-2xl font-semibold mb-4">File Search Errors</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Access denied or invalid path&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Path is outside allowed directories. File search only works in home directory (~), /tmp, and /var/tmp.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Not a directory&quot; / &quot;Directory not found&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Project path doesn&apos;t exist or isn&apos;t a directory. Verify you&apos;re providing a directory, not a file path.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-red-400">&quot;Refusing to scan filesystem root&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Attempted to search from filesystem root (/), which is too broad. Specify a more specific project directory.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-mono font-medium mb-2 text-amber-400">&quot;Scan timeout after 5000ms&quot;</div>
            <p className="text-sm text-muted-foreground mb-3">
              Project has too many files. Partial results returned. Add patterns to .gitignore to exclude large directories.
            </p>
          </div>
        </div>
      </section>

      {/* Getting Help */}
      <section className="mb-12">
        <h2 id="getting-help" className="text-2xl font-semibold mb-4">Getting Help</h2>
        
        <Callout type="info" title="If you can't find your error">
          <ol className="list-decimal list-inside space-y-2 mt-2">
            <li>Run <code className="bg-muted/50 px-1 rounded">broski logs --follow</code> while reproducing the issue</li>
            <li>Run <code className="bg-muted/50 px-1 rounded">broski doctor --profile pairing</code> (or network/agents/daemon)</li>
            <li>Export a support bundle: <code className="bg-muted/50 px-1 rounded">broski logs --export</code></li>
            <li>Check the <a href="/docs/troubleshooting" className="text-primary hover:underline">troubleshooting guide</a></li>
            <li>Contact support at <a href="mailto:broskiappp@gmail.com" className="text-primary hover:underline">broskiappp@gmail.com</a></li>
          </ol>
        </Callout>
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
