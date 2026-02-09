import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";
import { Steps, SuccessStep } from "@/components/docs/steps";

export const metadata: Metadata = {
  title: "Remote Coding - Broski",
  description: "Code from anywhere using Tailscale for secure remote access",
};

export default function RemoteCodingPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="remote-coding" className="text-4xl font-bold mb-4">Remote Coding</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Code from anywhere using Tailscale for secure remote access.
      </p>

      {/* The Problem */}
      <section className="mb-12">
        <h2 id="the-problem" className="text-2xl font-semibold mb-4">The Problem</h2>
        <p className="text-muted-foreground mb-4">
          By default, Broski connects over your local WiFi network. This works great at home or office, 
          but what happens when you:
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li>• Leave the house for coffee and want to keep coding?</li>
          <li>• Travel and need to check on a long-running task?</li>
          <li>• Work from multiple locations throughout the day?</li>
           <li>• Want to approve a command while away from your system?</li>
        </ul>
        <p className="text-muted-foreground mt-4">
          <strong className="text-foreground">Without remote access, you lose connection as soon as you leave your network.</strong>
        </p>
      </section>

      {/* The Solution */}
      <section className="mb-12">
        <h2 id="the-solution" className="text-2xl font-semibold mb-4">The Solution: Tailscale</h2>
        <p className="text-muted-foreground mb-4">
          <a href="https://tailscale.com" className="text-primary hover:underline">Tailscale</a> creates a 
          secure, encrypted network between your devices that works from anywhere in the world. It&apos;s:
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li>• <strong className="text-foreground">Free</strong> for personal use (up to 100 devices)</li>
          <li>• <strong className="text-foreground">Easy</strong> to set up (no network configuration needed)</li>
          <li>• <strong className="text-foreground">Secure</strong> (WireGuard encrypted)</li>
          <li>• <strong className="text-foreground">Fast</strong> (peer-to-peer when possible)</li>
        </ul>

        <Callout type="info" title="How it works">
          Tailscale assigns each device a stable IP address (100.x.x.x) that works from anywhere. 
          Traffic is encrypted end-to-end using WireGuard.
        </Callout>
      </section>

      {/* Quick Setup */}
      <section className="mb-12">
        <h2 id="quick-setup" className="text-2xl font-semibold mb-4">Quick Setup</h2>
        <Steps
          steps={[
            {
              title: "Install Tailscale on your system",
              content: (
                <>
                  <p className="text-sm text-muted-foreground mb-2">Use the bridge&apos;s built-in wizard:</p>
                  <CodeBlock language="bash">{`broski setup-tailscale`}</CodeBlock>
                  <p className="text-sm text-muted-foreground mt-2">Or install manually:</p>
                  <CodeBlock language="bash">{`# macOS:
brew install --cask tailscale

# Windows:
# Download from https://tailscale.com/download/windows

# Linux:
# curl -fsSL https://tailscale.com/install.sh | sh`}</CodeBlock>
                </>
              ),
            },
            {
              title: "Sign in on your system",
              description: "Open Tailscale and sign in with Google, GitHub, or Microsoft.",
            },
            {
              title: "Install Tailscale on your phone",
              content: (
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• <strong>iOS:</strong> <a href="https://apps.apple.com/app/tailscale/id1470499037" className="text-primary hover:underline">App Store</a></li>
                  <li>• <strong>Android:</strong> <a href="https://play.google.com/store/apps/details?id=com.tailscale.ipn" className="text-primary hover:underline">Play Store</a></li>
                </ul>
              ),
            },
            {
              title: "Sign in on your phone",
              description: "Use the same account you used on your system. Both devices should now be on your \"tailnet\".",
            },
            {
              title: "Start the bridge",
              content: (
                <>
                  <CodeBlock language="bash">{`broski`}</CodeBlock>
                  <p className="text-sm text-muted-foreground mt-2">
                    The QR code now includes your Tailscale IP. Scan it with Broski.
                  </p>
                </>
              ),
            },
          ]}
        />

        <SuccessStep
          title="You can now code from anywhere!"
          description="As long as both devices have Tailscale connected, Broski will work from any network."
        />
      </section>

      {/* Funnel Option */}
      <section className="mb-12">
        <h2 id="funnel" className="text-2xl font-semibold mb-4">Funnel Option (No VPN on Phone)</h2>
        <p className="text-muted-foreground mb-4">
          Don&apos;t want to install Tailscale on your phone? Use <strong>Tailscale Funnel</strong> to 
          expose your bridge via a public HTTPS URL.
        </p>

        <Callout type="warning" title="Security note">
          Funnel creates a public URL. Your bridge is still protected by the auth token, 
          but you&apos;re exposing it to the internet. Use for convenience, not for sensitive work.
        </Callout>

        <h3 id="funnel-setup" className="text-lg font-semibold mt-6 mb-3">Enable Funnel</h3>
        <Steps
          steps={[
            {
              title: "Enable Funnel in Tailscale Admin",
              content: (
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Go to <a href="https://login.tailscale.com/admin" className="text-primary hover:underline">admin.tailscale.com</a></li>
                  <li>Navigate to DNS → Enable HTTPS</li>
                  <li>Then go to Access controls and enable Funnel</li>
                  <li>Wait a few minutes for changes to propagate</li>
                </ol>
              ),
            },
            {
              title: "Start bridge with Funnel",
              content: <CodeBlock language="bash">{`broski --funnel`}</CodeBlock>,
            },
            {
              title: "Scan the QR code",
              description: "It now contains a public HTTPS URL (e.g., https://your-mac.tailnet-name.ts.net)",
            },
          ]}
        />

        <h3 id="funnel-vs-tailscale" className="text-lg font-semibold mt-6 mb-3">Funnel vs Tailscale VPN</h3>
        <SimpleTable
          headers={["Feature", "Tailscale VPN", "Funnel"]}
          rows={[
            ["Phone app required", "Yes (Tailscale)", "No"],
            ["Encryption", "WireGuard (E2E)", "TLS (to Tailscale edge)"],
            ["URL type", "ws://100.x.x.x:port", "wss://name.ts.net"],
            ["Latency", "Lower (direct)", "Higher (via Tailscale)"],
            ["Public access", "No", "Yes"],
            ["Setup", "Install on both", "Enable in admin"],
          ]}
        />
      </section>

      {/* Latency Expectations */}
      <section className="mb-12">
        <h2 id="latency" className="text-2xl font-semibold mb-4">Latency Expectations</h2>
        <p className="text-muted-foreground mb-4">
          Different connection methods have different performance characteristics:
        </p>
        <SimpleTable
          headers={["Connection Type", "Typical Latency", "Experience"]}
          rows={[
            ["Local WiFi", "~10ms", "Instant, like being at your desk"],
            ["Tailscale (same city)", "~30-50ms", "Smooth, barely noticeable"],
            ["Tailscale (cross-country)", "~50-100ms", "Good, slight delay on typing"],
            ["Tailscale Funnel", "~100-200ms", "Usable, some buffering on streams"],
            ["Tailscale (international)", "~150-300ms", "Works, noticeable delay"],
          ]}
        />

        <Callout type="tip" title="The app adapts">
          Broski automatically adjusts streaming behavior based on your connection quality. 
          Higher latency means more batching for smoother experience.
        </Callout>
      </section>

      {/* Workflow Tips */}
      <section className="mb-12">
        <h2 id="workflow-tips" className="text-2xl font-semibold mb-4">Workflow Tips</h2>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Keep your system awake</div>
            <p className="text-sm text-muted-foreground">
              Your system needs to stay awake for the bridge to work. Adjust power/sleep settings or use:
            </p>
            <CodeBlock language="bash">{`# macOS: Keep system awake while bridge runs
caffeinate -i broski

# Linux:
# systemd-inhibit --what=idle broski

# Windows: Use the background service to keep it running
# broski install`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Run bridge as background service</div>
            <p className="text-sm text-muted-foreground">
              For always-on access, run the bridge as a LaunchAgent:
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              See <a href="/docs/bridge/background-service" className="text-primary hover:underline">Background Service</a> for setup instructions.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Check connection before important tasks</div>
            <p className="text-sm text-muted-foreground">
              Look at the connection indicator in the app. Green = good, Yellow = okay but slow, Red = disconnected.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Use local when possible</div>
            <p className="text-sm text-muted-foreground">
              When you&apos;re back on the same network as your system, Broski will automatically use the faster local connection.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Queue messages during poor connectivity</div>
            <p className="text-sm text-muted-foreground">
              If connection drops briefly, your messages are queued and sent when reconnected. 
              Don&apos;t keep retapping send.
            </p>
          </div>
        </div>
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-4">Common Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Can&apos;t connect via Tailscale</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Check Tailscale is connected on both devices</li>
              <li>• Verify both are on the same account (same tailnet)</li>
              <li>• Try <code className="bg-muted/50 px-1 rounded">tailscale ping &lt;mac-ip&gt;</code> from phone</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Funnel not working</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Ensure Funnel is enabled in Tailscale admin console</li>
              <li>• Wait 5-10 minutes after enabling for propagation</li>
              <li>• Check <code className="bg-muted/50 px-1 rounded">tailscale funnel status</code></li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">High latency</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Check if traffic is being relayed (see Tailscale status)</li>
              <li>• Try switching networks (e.g., WiFi → cellular)</li>
              <li>• If using Funnel, consider installing Tailscale on phone instead</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Connection drops when switching networks</div>
            <p className="text-sm text-muted-foreground">
              This is normal. The app will auto-reconnect when your phone has stable network again. 
              Tailscale handles IP changes automatically.
            </p>
          </div>
        </div>
      </section>

      {/* Summary */}
      <section className="mb-12">
        <h2 id="summary" className="text-2xl font-semibold mb-4">Summary</h2>
        <SimpleTable
          headers={["If you want...", "Use this"]}
          rows={[
            ["Best performance + security", "Tailscale on both devices"],
            ["No app on phone + convenience", "Tailscale Funnel"],
            ["Best latency", "Local WiFi (same network)"],
            ["Work + personal device separation", "Funnel (work phone doesn't need Tailscale)"],
          ]}
        />
      </section>

      {/* Related */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="related" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access (Technical)</h3>
            <p className="text-sm text-muted-foreground">Detailed Tailscale configuration</p>
          </a>
          <a href="/docs/bridge/background-service" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Background Service</h3>
            <p className="text-sm text-muted-foreground">Run bridge automatically</p>
          </a>
          <a href="/docs/troubleshooting/network" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Network Troubleshooting</h3>
            <p className="text-sm text-muted-foreground">Fix connectivity issues</p>
          </a>
          <a href="/docs/guides/first-session" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Your First Session</h3>
            <p className="text-sm text-muted-foreground">Getting started with Broski</p>
          </a>
        </div>
      </section>
    </article>
  );
}
