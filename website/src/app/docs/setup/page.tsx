import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { Callout } from "@/components/docs/callout";
import { SimpleTable } from "@/components/docs/docs-table";
import { Card, CardGrid } from "@/components/docs/card";
import { TerminalMockup } from "@/components/docs/terminal-mockup";

export const metadata: Metadata = {
  title: "Setup Guide - Broski",
  description: "Complete setup guide for Broski - Install the bridge and connect your phone",
};

export default function SetupPage() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">Setup Guide</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Get Broski running in under 5 minutes.
      </p>

      {/* Prerequisites */}
      <section className="mb-12">
        <h2 id="prerequisites" className="text-2xl font-semibold mb-4">Prerequisites</h2>
        <div className="bg-card/50 border border-border/50 rounded-lg p-6">
          <ul className="space-y-3 text-muted-foreground">
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span>A computer (macOS 12+, Windows 10+, or Linux)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span>A smartphone (iOS 15+ or Android 8+)</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span>At least one AI coding agent installed (Claude Code or Pi)</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Step 1: Install Bridge */}
      <section className="mb-12">
        <h2 id="step-1-install" className="text-2xl font-semibold mb-4">Step 1: Install the Bridge</h2>
        <p className="text-muted-foreground mb-4">
          The bridge is a lightweight server that runs on your computer and connects your phone to your 
          AI coding agents. Choose your platform below.
        </p>

        <p className="text-muted-foreground mb-4">
          Download and install the Broski bridge for your platform, then run it from your terminal:
        </p>

        {/* macOS */}
        <h3 id="macos" className="text-lg font-semibold mb-3">macOS</h3>
        <CodeBlock language="bash">{`broski`}</CodeBlock>

        {/* Windows */}
        <h3 id="windows" className="text-lg font-semibold mb-3 mt-8">Windows</h3>
        <CodeBlock language="bash">{`broski`}</CodeBlock>

        {/* Linux */}
        <h3 id="linux" className="text-lg font-semibold mb-3 mt-8">Linux</h3>
        <CodeBlock language="bash">{`broski`}</CodeBlock>
      </section>

      {/* Step 2: Verify Installation */}
      <section className="mb-12">
        <h2 id="step-2-verify" className="text-2xl font-semibold mb-4">Step 2: Verify Installation</h2>
        <p className="text-muted-foreground mb-4">
          Run diagnostics to verify setup, then apply safe fixes if needed:
        </p>
        
        <CodeBlock language="bash">{`broski doctor
broski doctor --fix`}</CodeBlock>

        <p className="text-muted-foreground mt-4 mb-2">Common focused checks:</p>
        <CodeBlock language="bash">{`# Pairing readiness (token + TLS + QR)
broski doctor --profile pairing

# Backend readiness (Claude/Pi)
broski doctor --profile agents`}</CodeBlock>

        <Callout type="warning" title="Failed checks?">
          Run <code className="bg-muted/50 px-1 rounded">broski doctor --fix</code>, then export diagnostics if still stuck:
          <CodeBlock language="bash">{`broski doctor --export`}</CodeBlock>
        </Callout>
      </section>

      {/* Step 3: Start the Bridge */}
      <section className="mb-12">
        <h2 id="step-3-start" className="text-2xl font-semibold mb-4">Step 3: Start the Bridge</h2>
        <p className="text-muted-foreground mb-4">
          When you run the bridge, you&apos;ll see a QR code in your terminal:
        </p>

        <TerminalMockup />

        <p className="text-muted-foreground text-sm mt-4">
          Keep this terminal window open. The bridge needs to be running for Broski to work.
        </p>
      </section>

      {/* Step 4: Download App */}
      <section className="mb-12">
        <h2 id="step-4-download" className="text-2xl font-semibold mb-4">Step 4: Download Broski</h2>
        <p className="text-muted-foreground mb-4">
          Download Broski for your mobile device:
        </p>
        
        <SimpleTable
          headers={["Platform", "Download", "Requirements"]}
          rows={[
            [
              <strong key="ios">iOS</strong>,
              "App Store (coming soon)",
              "iOS 15.0+"
            ],
            [
              <strong key="android">Android</strong>,
              "Coming soon",
              "In development"
            ],
          ]}
        />

        <CardGrid>
          <Card
            href="/docs/setup/ios"
            title="iOS Setup Guide"
            description="Detailed setup for iPhone and iPad"
          />
          <Card
            href="#"
            title="Android Setup Guide"
            description="Coming soon (currently in development)"
          />
        </CardGrid>
      </section>

      {/* Step 5: Connect */}
      <section className="mb-12">
        <h2 id="step-5-connect" className="text-2xl font-semibold mb-4">Step 5: Connect</h2>
        <ol className="space-y-4 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold shrink-0">1</span>
            <span>Open Broski on your phone</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold shrink-0">2</span>
            <span>Tap <strong className="text-foreground">&quot;Scan QR Code&quot;</strong></span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold shrink-0">3</span>
            <span>Point your camera at the QR code in your terminal</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-[#7fd88f]/20 text-[#7fd88f] flex items-center justify-center text-sm font-bold shrink-0">&#10003;</span>
            <span><strong className="text-foreground">Done!</strong> You&apos;re now connected to your computer</span>
          </li>
        </ol>
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-4">Common Issues</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;Port already in use&quot;</h3>
            <p className="text-muted-foreground text-sm mb-2">
              Another process is using port 18274. Find and kill it, or use a different port:
            </p>
            <CodeBlock language="bash">{`# Find what's using the port
lsof -nP -iTCP:18274 -sTCP:LISTEN

# Or use a different port
broski --port 8080`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;Can&apos;t scan QR code&quot;</h3>
            <p className="text-muted-foreground text-sm">
              Make sure your phone and computer are on the same WiFi network. 
              If scanning fails, tap &quot;Enter manually&quot; and type the IP address shown in your terminal.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;Connection failed&quot;</h3>
            <p className="text-muted-foreground text-sm mb-2">
              Run focused diagnostics first, then apply firewall rules if needed:
            </p>
            <CodeBlock language="bash">{`broski doctor --profile pairing
broski doctor --profile network

# macOS: allow incoming connections
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which broski)

# Linux (UFW)
sudo ufw allow 18274/tcp`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;No AI agents found&quot;</h3>
            <p className="text-muted-foreground text-sm">
              Make sure you have at least one AI coding agent installed:
            </p>
            <CodeBlock language="bash">{`# Check installed agents
which claude    # Claude Code
which pi        # Pi`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;broski: command not found&quot;</h3>
            <p className="text-muted-foreground text-sm mb-2">
              Make sure the Broski bin directory is in your PATH:
            </p>
            <CodeBlock language="bash">{`# Add to your shell profile (~/.bashrc or ~/.zshrc)
export PATH="$HOME/.broski/bin:$PATH"

# Then reload
source ~/.bashrc  # or source ~/.zshrc`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section>
        <h2 id="next-steps" className="text-2xl font-semibold mb-4">Next Steps</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <a 
            href="/docs/bridge/remote-access"
            className="block p-4 border border-border/50 rounded-lg hover:border-primary/50 transition-colors"
          >
            <h3 className="font-semibold mb-1">Remote Access &rarr;</h3>
            <p className="text-muted-foreground text-sm">
              Access your AI from anywhere through a relay
            </p>
          </a>
          <a 
            href="/docs/bridge/configuration"
            className="block p-4 border border-border/50 rounded-lg hover:border-primary/50 transition-colors"
          >
            <h3 className="font-semibold mb-1">Configuration &rarr;</h3>
            <p className="text-muted-foreground text-sm">
              Customize bridge settings and behavior
            </p>
          </a>
        </div>
      </section>
    </article>
  );
}
