import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Connection Issues - Broski",
  description: "Troubleshoot connection problems with Broski",
};

export default function ConnectionTroubleshootingPage() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">Connection Issues</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Can&apos;t connect? Here&apos;s how to diagnose and fix connection problems.
      </p>

      {/* Quick Diagnostics */}
      <section className="mb-12">
        <h2 id="diagnostics" className="text-2xl font-semibold mb-4">Quick Diagnostics</h2>
        <p className="text-muted-foreground mb-4">
          Run these commands to check your setup:
        </p>
        <p className="text-sm text-muted-foreground mb-2">Check if bridge is running:</p>
        <CodeBlock language="bash">{`curl http://localhost:18274/`}</CodeBlock>
        <p className="text-xs text-muted-foreground mb-4">
          Expected: <code className="text-foreground">{`{"status":"ok"}`}</code>
        </p>
        
        <p className="text-sm text-muted-foreground mb-2">Check what&apos;s using the port:</p>
        <CodeBlock language="bash">{`lsof -nP -iTCP:18274 -sTCP:LISTEN`}</CodeBlock>
        
        <p className="text-sm text-muted-foreground mb-2 mt-4">Check Tailscale status (if using):</p>
        <CodeBlock language="bash">{`tailscale status`}</CodeBlock>
      </section>

      {/* Cannot Connect */}
      <section className="mb-12">
        <h2 id="cannot-connect" className="text-2xl font-semibold mb-4">Cannot Connect to Bridge</h2>
        
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-6">
          <p className="font-medium text-destructive">Symptom: App shows &quot;Disconnected&quot; or &quot;Connection failed&quot;</p>
        </div>

        <h3 className="font-semibold mb-3">Step 1: Is the bridge running?</h3>
        <CodeBlock language="bash">{`ps aux | grep broski`}</CodeBlock>
        <p className="text-muted-foreground mb-6">
          If nothing shows up, start the bridge:
        </p>
        <CodeBlock language="bash">{`bunx broski`}</CodeBlock>

        <h3 className="font-semibold mb-3">Step 2: Are you on the same network?</h3>
        <ul className="text-muted-foreground space-y-2 mb-6">
          <li>&#8226; For local connections, phone and Mac must be on the <strong className="text-foreground">same WiFi</strong></li>
          <li>&#8226; Check your phone&apos;s WiFi settings</li>
          <li>&#8226; 5GHz and 2.4GHz networks may be isolated on some routers</li>
        </ul>

        <h3 className="font-semibold mb-3">Step 3: Is the firewall blocking?</h3>
        <p className="text-sm text-muted-foreground mb-2">macOS: Check firewall status:</p>
        <CodeBlock language="bash">{`/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`}</CodeBlock>
        <p className="text-muted-foreground mb-6">
          If enabled, add an exception for Node.js/Bun or allow port 18274.
        </p>

        <h3 className="font-semibold mb-3">Step 4: Is the token correct?</h3>
        <ul className="text-muted-foreground space-y-2">
          <li>&#8226; Re-scan the QR code to get a fresh token</li>
          <li>&#8226; Or run <code className="text-foreground">broski --new-token</code> to regenerate</li>
        </ul>
      </section>

      {/* Port In Use */}
      <section className="mb-12">
        <h2 id="port-in-use" className="text-2xl font-semibold mb-4">Port Already in Use</h2>
        
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-6">
          <p className="font-medium text-destructive">Error: &quot;Bridge port 18274 is already in use&quot;</p>
        </div>

        <h3 className="font-semibold mb-3">Find what&apos;s using the port</h3>
        <CodeBlock language="bash">{`lsof -nP -iTCP:18274 -sTCP:LISTEN`}</CodeBlock>

        <h3 className="font-semibold mb-3">Solutions</h3>
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h4 className="font-medium mb-2">Option 1: Kill the existing process</h4>
            <CodeBlock language="bash">{`lsof -nP -iTCP:18274 -sTCP:LISTEN | awk 'NR>1 {print $2}' | xargs kill`}</CodeBlock>
          </div>
          
          <div className="border border-border/50 rounded-lg p-4">
            <h4 className="font-medium mb-2">Option 2: Suspended process (Ctrl+Z issue)</h4>
            <p className="text-muted-foreground text-sm mb-2">
              If you accidentally pressed Ctrl+Z instead of Ctrl+C:
            </p>
            <CodeBlock language="bash">{`jobs
fg`}</CodeBlock>
            <p className="text-muted-foreground text-xs mt-2">Then press Ctrl+C to stop properly</p>
          </div>
          
          <div className="border border-border/50 rounded-lg p-4">
            <h4 className="font-medium mb-2">Option 3: Use a different port</h4>
            <CodeBlock language="bash">{`broski --port 18275`}</CodeBlock>
            <p className="text-muted-foreground text-xs mt-2">Or use <code>--port 0</code> for a random free port</p>
          </div>
        </div>
      </section>

      {/* Connection Drops */}
      <section className="mb-12">
        <h2 id="connection-drops" className="text-2xl font-semibold mb-4">Connection Keeps Dropping</h2>
        
        <div className="bg-muted/30 border border-border rounded-lg p-4 mb-6">
          <p className="font-medium">Symptom: Disconnects frequently, &quot;Heartbeat timeout&quot;</p>
        </div>

        <h3 className="font-semibold mb-3">Common Causes</h3>
        <div className="space-y-3 mb-6">
          <div className="flex items-start gap-3 text-muted-foreground">
            <span className="text-primary mt-1">&#8226;</span>
            <div>
              <strong className="text-foreground">Weak WiFi signal</strong>
              <p className="text-sm">Move closer to your router or check signal strength</p>
            </div>
          </div>
          <div className="flex items-start gap-3 text-muted-foreground">
            <span className="text-primary mt-1">&#8226;</span>
            <div>
              <strong className="text-foreground">iOS killing background app</strong>
              <p className="text-sm">Keep Broski in foreground, or enable background refresh</p>
            </div>
          </div>
          <div className="flex items-start gap-3 text-muted-foreground">
            <span className="text-primary mt-1">&#8226;</span>
            <div>
              <strong className="text-foreground">Bridge crashed</strong>
              <p className="text-sm">Check your terminal - restart if needed</p>
            </div>
          </div>
          <div className="flex items-start gap-3 text-muted-foreground">
            <span className="text-primary mt-1">&#8226;</span>
            <div>
              <strong className="text-foreground">Network switching</strong>
              <p className="text-sm">Phone may be switching between WiFi and cellular</p>
            </div>
          </div>
        </div>

        <h3 className="font-semibold mb-3">Solutions</h3>
        <ul className="text-muted-foreground space-y-2">
          <li>&#8226; Disable cellular data while using Broski</li>
          <li>&#8226; Use a wired connection on your Mac if possible</li>
          <li>&#8226; Enable Tailscale for more stable connections</li>
          <li>&#8226; Check for router firmware updates</li>
        </ul>
      </section>

      {/* QR Code Issues */}
      <section className="mb-12">
        <h2 id="qr-code" className="text-2xl font-semibold mb-4">QR Code Scanning Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Camera can&apos;t focus on QR code</h3>
            <ul className="text-muted-foreground text-sm space-y-1">
              <li>&#8226; Increase terminal font size</li>
              <li>&#8226; Use a lighter terminal theme</li>
              <li>&#8226; Increase screen brightness</li>
              <li>&#8226; Hold phone 6-12 inches from screen</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">QR code not displaying correctly</h3>
            <ul className="text-muted-foreground text-sm space-y-1">
              <li>&#8226; Make terminal window wider</li>
              <li>&#8226; Use smaller font size</li>
              <li>&#8226; Try a different terminal app</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Manual connection (skip QR)</h3>
            <p className="text-muted-foreground text-sm mb-2">
              You can enter the connection details manually:
            </p>
            <ol className="text-muted-foreground text-sm space-y-1">
              <li>1. Note the IP and port from bridge output</li>
              <li>2. In Broski, tap &quot;Manual Entry&quot;</li>
              <li>3. Enter: <code className="text-foreground">ws://IP:PORT</code></li>
            </ol>
          </div>
        </div>
      </section>

      {/* Still Having Issues */}
      <section className="bg-card/50 border border-border/50 rounded-lg p-6">
        <h2 id="help" className="text-xl font-semibold mb-3">Still having issues?</h2>
        <p className="text-muted-foreground mb-4">
          Collect this debug info before contacting support:
        </p>
        <CodeBlock language="bash">{`broski --version
bun --version && node --version
sw_vers`}</CodeBlock>
        <p className="text-muted-foreground mt-4">
          Email: <a href="mailto:broskiappp@gmail.com" className="text-primary hover:underline">broskiappp@gmail.com</a>
        </p>
      </section>
    </article>
  );
}
