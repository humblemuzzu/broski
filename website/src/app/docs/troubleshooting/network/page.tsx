import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Network Issues - Broski",
  description: "Diagnose and fix network connectivity problems between your phone and Mac",
};

export default function NetworkTroubleshootingPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="network-issues" className="text-4xl font-bold mb-4">Network Issues</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Diagnose and fix network connectivity problems between your phone and Mac.
      </p>

      {/* Diagnostics First */}
      <section className="mb-12">
        <h2 id="diagnostics" className="text-2xl font-semibold mb-4">Run Diagnostics First</h2>
        <p className="text-muted-foreground mb-4">
          Always start by running the doctor command:
        </p>
        <CodeBlock language="bash">{`bunx broski doctor`}</CodeBlock>
        <p className="text-sm text-muted-foreground mt-3">
          This checks: dependencies, local IP, port availability, and Tailscale status.
        </p>
      </section>

      {/* Local Connection Issues */}
      <section className="mb-12">
        <h2 id="local-issues" className="text-2xl font-semibold mb-4">Local Connection (Same WiFi)</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Can&apos;t connect on local network</h3>
            <p className="text-sm text-muted-foreground mb-3">Most common issues:</p>
            <ul className="text-sm space-y-2 mb-4">
              <li className="flex items-start gap-2">
                <span className="font-medium">1.</span>
                <span><strong>Different networks:</strong> Ensure phone and Mac are on the same WiFi network.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-medium">2.</span>
                <span><strong>Firewall blocking:</strong> macOS firewall may block incoming connections.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-medium">3.</span>
                <span><strong>Client isolation:</strong> Some routers isolate wireless clients.</span>
              </li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Check Mac firewall</h3>
            <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
              <li>Open System Preferences/Settings → Security &amp; Privacy → Firewall</li>
              <li>Click &quot;Firewall Options...&quot;</li>
              <li>Ensure &quot;Block all incoming connections&quot; is OFF</li>
              <li>Or add an exception for the broski bridge</li>
            </ol>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Test connectivity manually</h3>
            <CodeBlock language="bash">{`# Get your Mac's local IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# From another device, test the connection
curl http://192.168.1.100:18274/

# Check if port is listening
lsof -nP -iTCP:18274 -sTCP:LISTEN`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Tailscale Issues */}
      <section className="mb-12">
        <h2 id="tailscale-issues" className="text-2xl font-semibold mb-4">Tailscale Connection</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Tailscale not connecting</h3>
            <CodeBlock language="bash">{`# Check Tailscale status
tailscale status

# Check your Tailscale IP
tailscale ip

# Verify connection to tailnet
tailscale ping <other-device-tailscale-ip>`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Both devices must be on Tailscale</h3>
            <p className="text-sm text-muted-foreground mb-3">
              For Tailscale to work, both your Mac and phone must:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Have Tailscale installed</li>
              <li>Be logged into the same Tailscale account (same tailnet)</li>
              <li>Be connected (not disconnected/paused)</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Connection Drops */}
      <section className="mb-12">
        <h2 id="connection-drops" className="text-2xl font-semibold mb-4">Connection Drops</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Frequent disconnections</h3>
            <p className="text-sm text-muted-foreground mb-3">Common causes:</p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li><strong>WiFi switching:</strong> Phone moving between WiFi and cellular</li>
              <li><strong>Sleep mode:</strong> Mac going to sleep closes the connection</li>
              <li><strong>App backgrounded:</strong> iOS may kill WebSocket when app is backgrounded</li>
              <li><strong>Network instability:</strong> Poor WiFi signal or congestion</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-2">Auto-reconnect behavior</h3>
            <p className="text-sm text-muted-foreground">
              The app automatically attempts to reconnect with exponential backoff. 
              If you see &quot;Reconnecting...&quot;, wait for it to complete. You can also 
              manually tap to reconnect or re-scan the QR code.
            </p>
          </div>
        </div>
      </section>

      {/* Testing Connectivity */}
      <section className="mb-12">
        <h2 id="testing" className="text-2xl font-semibold mb-4">Testing Connectivity</h2>
        <CodeBlock language="bash">{`# 1. Check bridge is running
curl http://localhost:18274/

# 2. Get your local IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# 3. Test from another device
curl http://<your-ip>:18274/

# 4. Check Tailscale IP
tailscale ip
curl http://<tailscale-ip>:18274/

# 5. Run full diagnostics
bunx broski doctor`}</CodeBlock>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access</h3>
            <p className="text-sm text-muted-foreground">Set up Tailscale properly</p>
          </a>
          <a href="/docs/troubleshooting/connection" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Connection Issues</h3>
            <p className="text-sm text-muted-foreground">General connection troubleshooting</p>
          </a>
        </div>
      </section>
    </article>
  );
}
