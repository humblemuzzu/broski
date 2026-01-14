import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
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
              <span>A Mac running macOS 12 (Monterey) or later</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span>Node.js 18+ or Bun installed</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span>An iPhone or iPad running iOS 15+</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-primary mt-1">&#10003;</span>
              <span>At least one AI coding agent installed (Claude Code, OpenCode, or Codex CLI)</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Step 1: Install Bridge */}
      <section className="mb-12">
        <h2 id="step-1-install" className="text-2xl font-semibold mb-4">Step 1: Install the Bridge</h2>
        <p className="text-muted-foreground mb-4">
          The bridge is a lightweight server that runs on your Mac and connects your phone to your 
          AI coding agents. Install it globally or run it directly with npx/bunx.
        </p>

        <h3 id="option-a" className="text-lg font-semibold mb-3">Option A: Run directly (recommended)</h3>
        <p className="text-sm text-muted-foreground mb-2">Using Bun (faster):</p>
        <CodeBlock language="bash">{`bunx broski`}</CodeBlock>
        
        <p className="text-sm text-muted-foreground mb-2 mt-4">Using npm:</p>
        <CodeBlock language="bash">{`npx broski`}</CodeBlock>

        <h3 id="option-b" className="text-lg font-semibold mb-3 mt-8">Option B: Install globally</h3>
        <p className="text-sm text-muted-foreground mb-2">Using Bun:</p>
        <CodeBlock language="bash">{`bun install -g broski`}</CodeBlock>
        
        <p className="text-sm text-muted-foreground mb-2 mt-4">Using npm:</p>
        <CodeBlock language="bash">{`npm install -g broski`}</CodeBlock>
        
        <p className="text-muted-foreground text-sm mt-4">
          Then run:
        </p>
        <CodeBlock language="bash">{`broski`}</CodeBlock>
      </section>

      {/* Step 2: Start the Bridge */}
      <section className="mb-12">
        <h2 id="step-2-start" className="text-2xl font-semibold mb-4">Step 2: Start the Bridge</h2>
        <p className="text-muted-foreground mb-4">
          When you run the bridge, you&apos;ll see a QR code in your terminal:
        </p>

        <TerminalMockup />

        <p className="text-muted-foreground text-sm">
          Keep this terminal window open. The bridge needs to be running for Broski to work.
        </p>
      </section>

      {/* Step 3: Download App */}
      <section className="mb-12">
        <h2 id="step-3-download" className="text-2xl font-semibold mb-4">Step 3: Download Broski</h2>
        <p className="text-muted-foreground mb-4">
          Download Broski from the App Store on your iPhone or iPad.
        </p>
        <div className="bg-card/50 border border-border/50 rounded-lg p-6 text-center">
          <p className="text-muted-foreground mb-4">Coming soon to the App Store</p>
          <div className="inline-block bg-primary/10 text-primary px-4 py-2 rounded-lg font-medium">
            Available on iOS 15+
          </div>
        </div>
      </section>

      {/* Step 4: Connect */}
      <section className="mb-12">
        <h2 id="step-4-connect" className="text-2xl font-semibold mb-4">Step 4: Connect</h2>
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
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold shrink-0">&#10003;</span>
            <span><strong className="text-foreground">Done!</strong> You&apos;re now connected to your Mac</span>
          </li>
        </ol>
      </section>

      {/* Step 5: Start Coding */}
      <section className="mb-12">
        <h2 id="step-5-coding" className="text-2xl font-semibold mb-4">Step 5: Start Coding</h2>
        <p className="text-muted-foreground mb-4">
          Now you can interact with your AI coding agents from your phone:
        </p>
        <ul className="space-y-2 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>Chat with AI in real-time</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>Review and approve code changes</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>Switch between projects and sessions</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>Grant or deny file access permissions</span>
          </li>
        </ul>
      </section>

      {/* Troubleshooting */}
      <section className="mb-12">
        <h2 id="troubleshooting" className="text-2xl font-semibold mb-4">Troubleshooting</h2>
        
        <div className="space-y-4">
          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;Can&apos;t find QR code&quot;</h3>
            <p className="text-muted-foreground text-sm">
              Make sure your phone and Mac are on the same WiFi network. The bridge uses local 
              networking to communicate.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;Connection failed&quot;</h3>
            <p className="text-muted-foreground text-sm mb-2">
              Check if your firewall is blocking port 18274. On macOS:
            </p>
            <CodeBlock language="bash">{`sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/node`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-4">
            <h3 className="font-semibold mb-2">&quot;No AI agents found&quot;</h3>
            <p className="text-muted-foreground text-sm">
              Make sure you have at least one AI coding agent installed. The bridge automatically 
              detects Claude Code, OpenCode, and Codex CLI.
            </p>
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
              Access your AI from anywhere with Tailscale
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
