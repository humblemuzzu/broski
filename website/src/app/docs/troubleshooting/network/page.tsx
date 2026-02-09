import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";
import { Steps } from "@/components/docs/steps";

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
        <CodeBlock language="bash">{`broski doctor`}</CodeBlock>
        <p className="text-sm text-muted-foreground mt-3">
          This checks: dependencies, local IP, port availability, and Tailscale status.
        </p>
      </section>

      {/* Local Connection Issues */}
      <section className="mb-12">
        <h2 id="local-issues" className="text-2xl font-semibold mb-4">Local Connection (Same WiFi)</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Can&apos;t connect on local network</div>
            <p className="text-sm text-muted-foreground mb-3">Most common issues:</p>
            <ol className="text-sm space-y-2 list-decimal list-inside">
              <li><strong>Different networks:</strong> Ensure phone and Mac are on the same WiFi network</li>
              <li><strong>5GHz vs 2.4GHz:</strong> Some routers isolate these bands - try connecting both devices to the same band</li>
              <li><strong>Firewall blocking:</strong> macOS firewall may block incoming connections</li>
              <li><strong>Client isolation:</strong> Some routers isolate wireless clients from each other</li>
            </ol>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Test connectivity manually</div>
            <CodeBlock language="bash">{`# Get your Mac's local IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# Test bridge from Mac
curl http://localhost:18274/

# Test from another device on the network
curl http://192.168.1.100:18274/

# Check if port is listening
lsof -nP -iTCP:18274 -sTCP:LISTEN`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Corporate Network / Firewall */}
      <section className="mb-12">
        <h2 id="corporate-network" className="text-2xl font-semibold mb-4">Corporate Network / Firewall</h2>
        
        <Callout type="warning" title="Corporate networks often block peer-to-peer connections">
          If you&apos;re on a work network, local connections may be blocked. Use Tailscale instead.
        </Callout>

        <h3 id="corporate-symptoms" className="text-lg font-semibold mt-6 mb-3">Symptoms</h3>
        <ul className="text-muted-foreground space-y-2">
          <li>• Can&apos;t connect even though both devices are on the same WiFi</li>
          <li>• Connection works at home but not at office</li>
          <li>• QR code scans but connection times out</li>
        </ul>

        <h3 id="corporate-solutions" className="text-lg font-semibold mt-6 mb-3">Solutions</h3>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Option 1: Use Tailscale (Recommended)</div>
            <p className="text-sm text-muted-foreground mb-2">
              Tailscale creates an encrypted tunnel that bypasses corporate restrictions:
            </p>
            <CodeBlock language="bash">{`# Install Tailscale on Mac
brew install --cask tailscale

# Start bridge (Tailscale IP will be included in QR code)
broski`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">
              Install Tailscale on your phone and log in with the same account.
            </p>
          </div>
          
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Option 2: Request firewall exception</div>
            <p className="text-sm text-muted-foreground">
              Ask IT to allow traffic on port 18274 between wireless clients, or to whitelist 
              the bridge application.
            </p>
          </div>
          
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Option 3: Use mobile hotspot</div>
            <p className="text-sm text-muted-foreground">
              Create a mobile hotspot from your phone and connect your Mac to it. 
              This bypasses corporate network entirely.
            </p>
          </div>
        </div>
      </section>

      {/* VPN Conflicts */}
      <section className="mb-12">
        <h2 id="vpn-conflicts" className="text-2xl font-semibold mb-4">VPN Conflicts</h2>
        
        <Callout type="info" title="VPNs can interfere with local connections">
          When a VPN is active, your Mac&apos;s local IP may change or become unreachable from your phone.
        </Callout>

        <h3 id="vpn-symptoms" className="text-lg font-semibold mt-6 mb-3">Symptoms</h3>
        <ul className="text-muted-foreground space-y-2">
          <li>• Connection worked before enabling VPN</li>
          <li>• QR code shows different IP than expected</li>
          <li>• High latency when VPN is active</li>
        </ul>

        <h3 id="vpn-solutions" className="text-lg font-semibold mt-6 mb-3">Solutions</h3>
        <SimpleTable
          headers={["Scenario", "Solution"]}
          rows={[
            ["Corporate VPN active", "Disconnect VPN or use Tailscale"],
            ["Split tunnel available", "Exclude local IPs from VPN"],
            ["Tailscale + other VPN", "Tailscale usually works alongside other VPNs"],
            ["VPN changes routing", "Use Tailscale IP instead of local IP"],
          ]}
        />

        <h3 id="check-vpn-status" className="text-lg font-semibold mt-6 mb-3">Check VPN Status</h3>
        <CodeBlock language="bash">{`# Check active network interfaces
ifconfig | grep -A 2 "utun"  # VPN tunnels are usually utun*

# Check routing table for VPN routes
netstat -nr | grep -i utun

# See all network interfaces
networksetup -listallnetworkservices`}</CodeBlock>
      </section>

      {/* Tailscale Issues */}
      <section className="mb-12">
        <h2 id="tailscale-issues" className="text-2xl font-semibold mb-4">Tailscale Issues</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Tailscale not connecting</div>
            <CodeBlock language="bash">{`# Check Tailscale status
tailscale status

# Check your Tailscale IP
tailscale ip

# Verify connection to tailnet
tailscale ping <other-device-tailscale-ip>

# Check if Tailscale is logged in
tailscale status --json | jq '.Self.Online'`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Both devices must be on Tailscale</div>
            <p className="text-sm text-muted-foreground mb-3">
              For Tailscale to work, both your Mac and phone must:
            </p>
            <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
              <li>Have Tailscale installed</li>
              <li>Be logged into the same Tailscale account (same tailnet)</li>
              <li>Be connected (not disconnected/paused)</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Tailscale relayed vs direct</div>
            <CodeBlock language="bash">{`# Check connection type
tailscale status

# Look for "relay" in output - this means no direct connection
# Direct connections are faster and more reliable`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">
              If showing &quot;relay&quot;, check firewall settings on both devices to allow direct connections.
            </p>
          </div>
        </div>
      </section>

      {/* Port Forwarding */}
      <section className="mb-12">
        <h2 id="port-forwarding" className="text-2xl font-semibold mb-4">Port Forwarding</h2>
        
        <Callout type="warning" title="Port forwarding is NOT recommended">
          Exposing the bridge to the public internet is a security risk. Use Tailscale or Tailscale Funnel instead.
        </Callout>

        <p className="text-muted-foreground mb-4">
          If you must use port forwarding (e.g., for testing), here&apos;s how:
        </p>

        <Steps
          steps={[
            {
              title: "Find your Mac's local IP",
              content: <CodeBlock language="bash">{`ifconfig | grep "inet " | grep -v 127.0.0.1`}</CodeBlock>,
            },
            {
              title: "Log into your router's admin panel",
              description: "Usually at 192.168.1.1 or 192.168.0.1",
            },
            {
              title: "Find Port Forwarding settings",
              description: "Often under Advanced, NAT, or Gaming settings",
            },
            {
              title: "Create a port forward rule",
              description: "External port: 18274, Internal port: 18274, Internal IP: your Mac's IP, Protocol: TCP",
            },
            {
              title: "Find your public IP",
              content: <CodeBlock language="bash">{`curl ifconfig.me`}</CodeBlock>,
            },
            {
              title: "Connect using public IP",
              description: "Use the public IP in your connection URL instead of the local IP",
            },
          ]}
        />

        <Callout type="tip" title="Better alternative: Tailscale Funnel">
          Instead of port forwarding, use Tailscale Funnel for secure public access:
          <CodeBlock language="bash">{`broski --funnel`}</CodeBlock>
        </Callout>
      </section>

      {/* Testing Connectivity */}
      <section className="mb-12">
        <h2 id="testing" className="text-2xl font-semibold mb-4">Testing Connectivity</h2>
        <CodeBlock language="bash">{`# 1. Check bridge is running
curl http://localhost:18274/

# 2. Get your local IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# 3. Test from another device on same network
curl http://<your-local-ip>:18274/

# 4. Check Tailscale IP (if using)
tailscale ip
curl http://<tailscale-ip>:18274/

# 5. Test network latency
ping -c 5 <target-ip>

# 6. Run full diagnostics
broski doctor`}</CodeBlock>
      </section>

      {/* Connection Drops */}
      <section className="mb-12">
        <h2 id="connection-drops" className="text-2xl font-semibold mb-4">Connection Drops</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Frequent disconnections</div>
            <p className="text-sm text-muted-foreground mb-3">Common causes:</p>
            <SimpleTable
              headers={["Cause", "Solution"]}
              rows={[
                ["WiFi switching", "Lock your phone to a specific WiFi network"],
                ["Sleep mode", "Prevent Mac from sleeping while using Broski"],
                ["App backgrounded", "Keep Broski in foreground on iOS"],
                ["Network instability", "Move closer to router or use wired connection"],
                ["High latency", "Switch from Funnel to Tailscale direct"],
              ]}
            />
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Auto-reconnect behavior</div>
            <p className="text-sm text-muted-foreground">
              The app automatically attempts to reconnect with exponential backoff (2s, 4s, 8s, 16s, max 30s). 
              If you see &quot;Reconnecting...&quot;, wait for it to complete. You can also 
              manually tap to reconnect or re-scan the QR code.
            </p>
          </div>
        </div>
      </section>

      {/* Latency Guide */}
      <section className="mb-12">
        <h2 id="latency" className="text-2xl font-semibold mb-4">Latency Expectations</h2>
        <SimpleTable
          headers={["Connection Type", "Expected Latency", "Best For"]}
          rows={[
            ["Local WiFi", "1-30ms", "Home/office use, best experience"],
            ["Tailscale (nearby)", "30-50ms", "Same city/region"],
            ["Tailscale (distant)", "50-150ms", "Cross-country"],
            ["Tailscale Funnel", "100-300ms", "Public access, no VPN needed"],
          ]}
        />
        <p className="text-sm text-muted-foreground mt-4">
          RTT (Round-Trip Time) is shown in the app&apos;s connection indicator. 
          If latency is consistently high, try switching connection types.
        </p>
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
