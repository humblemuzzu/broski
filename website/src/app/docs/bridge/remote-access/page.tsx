import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Remote Access - Broski",
  description: "Access Broski from anywhere using Tailscale VPN",
};

export default function RemoteAccessPage() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">Remote Access</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Access your AI coding agents from anywhere in the world.
      </p>

      {/* Overview */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Why Tailscale?</h2>
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
              <span><strong className="text-foreground">Secure</strong> - end-to-end encrypted WireGuard tunnel</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span><strong className="text-foreground">No port forwarding</strong> - works behind NATs and firewalls</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span><strong className="text-foreground">Fast</strong> - peer-to-peer when possible</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Setup */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Setup</h2>
        
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
              1
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2">Install Tailscale on your Mac</h3>
              <p className="text-muted-foreground text-sm mb-3">
                Download from the App Store or install via Homebrew:
              </p>
              <CodeBlock language="bash">{`brew install --cask tailscale`}</CodeBlock>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
              2
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2">Install Tailscale on your iPhone</h3>
              <p className="text-muted-foreground text-sm">
                Download &quot;Tailscale&quot; from the App Store and sign in with the same account.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
              3
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2">Connect both devices</h3>
              <p className="text-muted-foreground text-sm mb-3">
                Enable Tailscale on both devices. They&apos;ll automatically find each other.
              </p>
              <div className="bg-card/50 border border-border/50 rounded-lg p-4">
                <p className="text-sm text-muted-foreground">
                  Your Mac will get a Tailscale IP like: <code className="text-foreground">100.x.x.x</code>
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
              4
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2">Start the bridge</h3>
              <p className="text-muted-foreground text-sm mb-3">
                Run the bridge on your Mac. It will automatically detect Tailscale:
              </p>
              <CodeBlock language="bash">{`broski`}</CodeBlock>
              <p className="text-muted-foreground text-xs mt-2">
                The QR code will include both local and Tailscale IPs.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-sm shrink-0">
              &#10003;
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2">Done! Access from anywhere</h3>
              <p className="text-muted-foreground text-sm">
                Broski will automatically use your Tailscale connection when you&apos;re away from home.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">How It Works</h2>
        
        <CodeBlock language="plaintext" showHeader={false}>
{`Same WiFi:
┌─────────────┐      Local WiFi       ┌─────────────┐
│   iPhone    │  ─────────────────►   │     Mac     │
└─────────────┘   192.168.1.x:18274   └─────────────┘

Away from home:
┌─────────────┐      Tailscale        ┌─────────────┐
│   iPhone    │  ─────────────────►   │     Mac     │
└─────────────┘   100.x.x.x:18274     └─────────────┘`}
        </CodeBlock>

        <p className="text-muted-foreground">
          Broski automatically detects when Tailscale is available and includes the Tailscale IP 
          in the connection QR code. When scanning, your phone tries both IPs and uses whichever works.
        </p>
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 className="text-2xl font-semibold mb-4">Troubleshooting</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;Connection failed&quot; over Tailscale</h3>
            <ul className="text-muted-foreground text-sm space-y-2">
              <li>&#8226; Make sure Tailscale is enabled on both devices</li>
              <li>&#8226; Check that both devices show as &quot;Connected&quot; in the Tailscale app</li>
              <li>&#8226; Try pinging your Mac&apos;s Tailscale IP from your phone</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Mac not showing Tailscale IP</h3>
            <p className="text-muted-foreground text-sm mb-2">
              Verify Tailscale is running:
            </p>
            <CodeBlock language="bash">{`tailscale status`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Slow connection</h3>
            <p className="text-muted-foreground text-sm">
              Tailscale tries to establish a direct connection, but may relay through servers if 
              your networks block direct connections. This can add latency. Try disabling any VPN 
              or firewall that might interfere.
            </p>
          </div>
        </div>
      </section>

      {/* Alternatives */}
      <section>
        <h2 className="text-2xl font-semibold mb-4">Alternatives</h2>
        
        <div className="bg-card/50 border border-border/50 rounded-lg p-6">
          <p className="text-muted-foreground mb-4">
            While Tailscale is recommended, other VPN solutions also work:
          </p>
          <ul className="space-y-2 text-muted-foreground text-sm">
            <li className="flex items-start gap-3">
              <span className="text-muted-foreground mt-1">&#8226;</span>
              <span><strong className="text-foreground">WireGuard</strong> - Self-hosted, more technical setup</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-muted-foreground mt-1">&#8226;</span>
              <span><strong className="text-foreground">ZeroTier</strong> - Similar to Tailscale, also free for personal use</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-muted-foreground mt-1">&#8226;</span>
              <span><strong className="text-foreground">Cloudflare Tunnel</strong> - If you want to use a domain</span>
            </li>
          </ul>
        </div>
      </section>
    </article>
  );
}
