import type { Metadata } from "next";
import { CodeBlock, Callout, SimpleTable, Steps } from "@/components/docs";

export const metadata: Metadata = {
  title: "Remote Access - Broski",
  description: "Access Broski from anywhere using Tailscale VPN",
};

export default function RemoteAccessPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="remote-access" className="text-4xl font-bold mb-4">Remote Access</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Access your AI coding agents from anywhere in the world using Tailscale.
      </p>

      {/* Connection Types Comparison */}
      <section className="mb-12">
        <h2 id="connection-comparison" className="text-2xl font-semibold mb-4">Connection Types Comparison</h2>
        <p className="text-muted-foreground mb-4">
          Choose the right connection type for your situation:
        </p>
        
        <SimpleTable
          headers={["Feature", "Local WiFi", "Tailscale VPN", "Tailscale Funnel"]}
          rows={[
            ["Latency", "1-30ms (fastest)", "30-100ms", "Variable (higher)"],
            ["Encryption", "None (local only)", "WireGuard", "TLS 1.3"],
            ["Phone app required", "Broski only", "Broski + Tailscale", "Broski only"],
            ["Public URL", "No", "No", "Yes"],
            ["Setup complexity", "None", "Install on both devices", "Enable in admin console"],
            ["Works from anywhere", "No (same WiFi)", "Yes", "Yes"],
            ["Best for", "Home/office use", "Secure remote access", "Sharing, demos"],
          ]}
        />
      </section>

      {/* Why Tailscale */}
      <section className="mb-12">
        <h2 id="why-tailscale" className="text-2xl font-semibold mb-4">Why Tailscale?</h2>
        <p className="text-muted-foreground mb-4">
          By default, Broski works on your local WiFi network. To code from anywhere (coffee shop, 
          airport, another city), use Tailscale - a zero-config VPN that creates a secure connection 
          between your devices.
        </p>
        <div className="bg-card/50 border border-border/50 rounded-lg p-6">
          <ul className="space-y-3 text-muted-foreground">
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span><strong className="text-foreground">Free</strong> for personal use (up to 100 devices)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span><strong className="text-foreground">Secure</strong> - WireGuard encryption (military-grade)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span><strong className="text-foreground">No port forwarding</strong> - works behind NATs and firewalls</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span><strong className="text-foreground">Fast</strong> - peer-to-peer when possible</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span><strong className="text-foreground">Stable IP</strong> - 100.x.x.x addresses that don&apos;t change</span>
            </li>
          </ul>
        </div>
      </section>

      {/* How it Works Diagram */}
      <section className="mb-12">
        <h2 id="how-it-works" className="text-2xl font-semibold mb-4">How It Works</h2>
        
        <div className="space-y-4 mb-4">
          {/* Same WiFi */}
          <div className="bg-muted/30 rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Same WiFi</div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded text-sm">iPhone</div>
              <div className="text-center flex-1 min-w-[100px]">
                <div className="text-muted-foreground">→</div>
                <div className="text-xs text-muted-foreground">192.168.1.x:18274</div>
                <div className="text-xs text-green-500">Fast, local only</div>
              </div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm">Mac</div>
            </div>
          </div>
          
          {/* Tailscale VPN */}
          <div className="bg-muted/30 rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Away from Home (Tailscale VPN)</div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded text-sm text-center">
                <div>iPhone</div>
                <div className="text-xs text-muted-foreground">anywhere</div>
              </div>
              <div className="text-center flex-1 min-w-[100px]">
                <div className="text-muted-foreground">→</div>
                <div className="text-xs text-muted-foreground">100.x.x.x:18274</div>
                <div className="text-xs text-blue-500">WireGuard encrypted</div>
              </div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm text-center">
                <div>Mac</div>
                <div className="text-xs text-muted-foreground">home</div>
              </div>
            </div>
          </div>
          
          {/* Funnel */}
          <div className="bg-muted/30 rounded-lg border border-border p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">Away from Home (Funnel)</div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="px-3 py-2 bg-primary/10 border border-primary/30 rounded text-sm text-center">
                <div>iPhone</div>
                <div className="text-xs text-muted-foreground">anywhere</div>
              </div>
              <div className="text-center flex-1 min-w-[100px]">
                <div className="text-muted-foreground">→</div>
                <div className="text-xs text-muted-foreground">https://mac.ts.net</div>
                <div className="text-xs text-purple-500">TLS encrypted</div>
              </div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm text-center">
                <div>Tailscale Edge</div>
              </div>
              <div className="text-muted-foreground">→</div>
              <div className="px-3 py-2 bg-muted border border-border rounded text-sm text-center">
                <div>Mac</div>
                <div className="text-xs text-muted-foreground">home</div>
              </div>
            </div>
          </div>
        </div>

        <p className="text-muted-foreground">
          Broski automatically detects when Tailscale is available and includes the Tailscale IP 
          in the connection QR code. When scanning, your phone tries both IPs and uses whichever works.
        </p>
      </section>

      {/* Desktop Setup */}
      <section className="mb-12">
        <h2 id="desktop-setup" className="text-2xl font-semibold mb-4">Desktop Setup</h2>
        
        <Steps
          steps={[
            { 
              title: "Install Tailscale on your Mac/PC", 
              description: "Download from tailscale.com or use the command below"
            },
            { 
              title: "Sign in to your Tailscale account", 
              description: "Use Google, Microsoft, GitHub, or email"
            },
            { 
              title: "Verify connection", 
              description: "Your Mac will get a Tailscale IP like 100.x.x.x"
            },
          ]}
        />

        <h3 className="text-lg font-medium mt-6 mb-3">Installation Commands</h3>
        
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">macOS (Homebrew):</p>
            <CodeBlock language="bash">{`brew install --cask tailscale`}</CodeBlock>
          </div>
          
          <div>
            <p className="text-sm text-muted-foreground mb-2">macOS (App Store):</p>
            <p className="text-sm">Search &quot;Tailscale&quot; in the Mac App Store</p>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-2">Linux (Ubuntu/Debian):</p>
            <CodeBlock language="bash">{`curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up`}</CodeBlock>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-2">Windows:</p>
            <p className="text-sm">Download from <a href="https://tailscale.com/download" className="text-primary hover:underline">tailscale.com/download</a></p>
          </div>
        </div>

        <h3 className="text-lg font-medium mt-6 mb-3">Verify Installation</h3>
        <CodeBlock language="bash">{`# Check Tailscale status
tailscale status

# Get your Tailscale IP
tailscale ip -4
# Should output: 100.x.x.x`}</CodeBlock>
      </section>

      {/* Phone Setup */}
      <section className="mb-12">
        <h2 id="phone-setup" className="text-2xl font-semibold mb-4">Phone Setup</h2>
        
        <div className="grid gap-6 md:grid-cols-2">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-3">iOS</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Open the App Store</li>
              <li>Search for &quot;Tailscale&quot;</li>
              <li>Download and install</li>
              <li>Open Tailscale and sign in with <strong className="text-foreground">the same account</strong></li>
              <li>Enable the VPN when prompted</li>
            </ol>
            <a 
              href="https://apps.apple.com/app/tailscale/id1470499037" 
              className="inline-block mt-3 text-sm text-primary hover:underline"
            >
              App Store Link
            </a>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-medium mb-3">Android</h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Open the Play Store</li>
              <li>Search for &quot;Tailscale&quot;</li>
              <li>Download and install</li>
              <li>Open Tailscale and sign in with <strong className="text-foreground">the same account</strong></li>
              <li>Allow VPN connection when prompted</li>
            </ol>
            <a 
              href="https://play.google.com/store/apps/details?id=com.tailscale.ipn" 
              className="inline-block mt-3 text-sm text-primary hover:underline"
            >
              Play Store Link
            </a>
          </div>
        </div>

        <Callout type="warning" title="Important">
          You must sign in with the <strong>same Tailscale account</strong> on both your Mac and phone. 
          Different accounts cannot see each other.
        </Callout>
      </section>

      {/* MagicDNS */}
      <section className="mb-12">
        <h2 id="magicdns" className="text-2xl font-semibold mb-4">MagicDNS (Human-Readable Hostnames)</h2>
        <p className="text-muted-foreground mb-4">
          Instead of remembering IP addresses like <code>100.64.0.15</code>, MagicDNS lets you use 
          hostnames like <code>macbook.tail1234.ts.net</code>.
        </p>

        <h3 className="text-lg font-medium mt-4 mb-3">Enable MagicDNS</h3>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground mb-4">
          <li>Go to <a href="https://login.tailscale.com/admin/dns" className="text-primary hover:underline">Tailscale Admin Console</a></li>
          <li>Navigate to the <strong className="text-foreground">DNS</strong> tab</li>
          <li>Enable <strong className="text-foreground">MagicDNS</strong></li>
        </ol>

        <h3 className="text-lg font-medium mt-4 mb-3">Find Your Hostname</h3>
        <CodeBlock language="bash">{`tailscale status --json | grep DNSName
# Example output: "DNSName": "macbook.tail1234.ts.net"`}</CodeBlock>

        <p className="text-muted-foreground mt-4">
          Once enabled, Broski will automatically include your MagicDNS hostname in the QR code.
        </p>
      </section>

      {/* Tailscale Funnel */}
      <section className="mb-12">
        <h2 id="funnel" className="text-2xl font-semibold mb-4">Tailscale Funnel (Public HTTPS)</h2>
        <p className="text-muted-foreground mb-4">
          Funnel exposes your bridge to the public internet via HTTPS. Your phone doesn&apos;t need 
          Tailscale installed - just scan the QR code from anywhere.
        </p>

        <Callout type="info" title="When to use Funnel">
          Use Funnel when you can&apos;t install Tailscale on your phone (work phone, borrowed device) 
          or for quick demos and sharing.
        </Callout>

        <h3 className="text-lg font-medium mt-6 mb-3">Enable Funnel</h3>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground mb-4">
          <li>Go to <a href="https://login.tailscale.com/admin/machines" className="text-primary hover:underline">Tailscale Admin Console</a></li>
          <li>Click on your machine</li>
          <li>Under &quot;Funnel&quot;, click &quot;Enable&quot;</li>
          <li>Accept the Funnel policy</li>
        </ol>

        <h3 className="text-lg font-medium mt-4 mb-3">Start Bridge with Funnel</h3>
        <CodeBlock language="bash">{`broski --funnel`}</CodeBlock>

        <p className="text-muted-foreground mt-4 mb-4">
          The QR code will now include a public HTTPS URL like <code>https://macbook.tail1234.ts.net</code>.
        </p>

        <h3 className="text-lg font-medium mt-4 mb-3">Funnel Security Details</h3>
        <SimpleTable
          headers={["Feature", "Details"]}
          rows={[
            ["Encryption", "TLS 1.3 (same as banking websites)"],
            ["Certificate", "Automatic Let's Encrypt via Tailscale"],
            ["Authentication", "Still requires your Broski auth token"],
            ["Rate limiting", "Handled by Tailscale edge"],
            ["Access logging", "Available in Tailscale admin console"],
          ]}
        />

        <Callout type="warning" title="Security Note">
          Funnel makes your bridge publicly accessible on the internet. While it&apos;s protected 
          by your auth token and TLS encryption, be mindful that it&apos;s publicly reachable. 
          Use <code>--new-token</code> to rotate your token if needed.
        </Callout>
      </section>

      {/* When to Use Which */}
      <section className="mb-12">
        <h2 id="when-to-use" className="text-2xl font-semibold mb-4">When to Use Which Connection</h2>
        
        <SimpleTable
          headers={["Scenario", "Recommended Connection"]}
          rows={[
            ["Working from home/office", "Local WiFi (fastest)"],
            ["Coffee shop or coworking space", "Tailscale VPN"],
            ["Traveling (hotel, airport)", "Tailscale VPN"],
            ["On cellular data", "Tailscale VPN"],
            ["Work phone (can't install apps)", "Tailscale Funnel"],
            ["Quick demo to a colleague", "Tailscale Funnel"],
            ["Maximum security required", "Tailscale VPN"],
            ["Sharing access temporarily", "Tailscale Funnel + new token after"],
          ]}
        />
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-4">Troubleshooting</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;Connection failed&quot; over Tailscale</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Verify Tailscale is enabled on both devices</li>
              <li>&#8226; Check both devices show as &quot;Connected&quot; in the Tailscale app</li>
              <li>&#8226; Test connectivity: <code className="bg-muted/50 px-1 rounded">tailscale ping &lt;phone-ip&gt;</code></li>
              <li>&#8226; Ensure same Tailscale account on both devices</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Mac not showing Tailscale IP</h3>
            <p className="text-muted-foreground text-sm mb-2">
              Verify Tailscale is running:
            </p>
            <CodeBlock language="bash">{`tailscale status
# Should show "Connected" and your IP`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Slow connection / high latency</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Tailscale tries direct P2P, but may relay through servers</li>
              <li>&#8226; Check if connection is relayed: <code className="bg-muted/50 px-1 rounded">tailscale netcheck</code></li>
              <li>&#8226; Ensure your router allows UDP (WireGuard uses UDP)</li>
              <li>&#8226; Try disabling any VPN that might interfere</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Funnel not working</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Ensure Funnel is enabled in the <a href="https://login.tailscale.com/admin" className="text-primary hover:underline">admin console</a></li>
              <li>&#8226; Check your machine has Funnel capability enabled</li>
              <li>&#8226; Verify with: <code className="bg-muted/50 px-1 rounded">tailscale funnel status</code></li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Phone not finding devices</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Open the Tailscale app on your phone</li>
              <li>&#8226; Ensure VPN is enabled (toggle should be on)</li>
              <li>&#8226; You should see your Mac in the device list</li>
              <li>&#8226; Try signing out and back in with the same account</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Alternatives */}
      <section className="mb-12">
        <h2 id="alternatives" className="text-2xl font-semibold mb-4">Alternatives to Tailscale</h2>
        
        <div className="bg-card/50 border border-border/50 rounded-lg p-6">
          <p className="text-muted-foreground mb-4">
            While Tailscale is recommended, other VPN solutions also work:
          </p>
          <ul className="space-y-3 text-muted-foreground text-sm">
            <li className="flex items-start gap-3">
              <span className="text-muted-foreground mt-1">&#8226;</span>
              <span><strong className="text-foreground">WireGuard</strong> - Self-hosted, more technical setup required</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-muted-foreground mt-1">&#8226;</span>
              <span><strong className="text-foreground">ZeroTier</strong> - Similar to Tailscale, also free for personal use</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-muted-foreground mt-1">&#8226;</span>
              <span><strong className="text-foreground">Cloudflare Tunnel</strong> - If you want to use your own domain</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-muted-foreground mt-1">&#8226;</span>
              <span><strong className="text-foreground">ngrok</strong> - Quick public URLs, but less suitable for always-on</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Next Steps</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/background-service" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Background Service</h3>
            <p className="text-sm text-muted-foreground">Run the bridge automatically on boot</p>
          </a>
          <a href="/docs/troubleshooting/network" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Network Troubleshooting</h3>
            <p className="text-sm text-muted-foreground">Solve WiFi, firewall, and connection issues</p>
          </a>
        </div>
      </section>
    </article>
  );
}
