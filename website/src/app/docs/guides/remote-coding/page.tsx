import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";
import { Steps, SuccessStep } from "@/components/docs/steps";

export const metadata: Metadata = {
  title: "Remote Coding - Broski",
  description: "Code from anywhere over Broski Link, with end-to-end encryption",
};

export default function RemoteCodingPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="remote-coding" className="text-4xl font-bold mb-4">Remote Coding</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Keep working with your agents when you leave your desk.
      </p>

      {/* The Problem */}
      <section className="mb-12">
        <h2 id="the-problem" className="text-2xl font-semibold mb-4">The Problem</h2>
        <p className="text-muted-foreground mb-4">
          On your home or office network, Broski talks to your Mac directly. But what happens when you:
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li>• Leave the house for coffee and want to keep coding?</li>
          <li>• Travel and need to check on a long-running task?</li>
          <li>• Work from multiple locations throughout the day?</li>
          <li>• Want to approve a command while away from your system?</li>
        </ul>
      </section>

      {/* The Solution */}
      <section className="mb-12">
        <h2 id="the-solution" className="text-2xl font-semibold mb-4">The Solution: Broski Link with a Relay</h2>
        <p className="text-muted-foreground mb-4">
          When your phone cannot reach your Mac directly, Broski Link connects both of them to a
          relay. The relay only forwards encrypted frames, so it cannot read your prompts, code or
          files. It is:
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li>• <strong className="text-foreground">Automatic</strong> (the app falls back to the relay when the local network is not reachable)</li>
          <li>• <strong className="text-foreground">Private</strong> (Noise end-to-end encryption between your phone and your Mac)</li>
          <li>• <strong className="text-foreground">Simple</strong> (no VPN, no extra app, no port forwarding, nothing exposed publicly)</li>
        </ul>
      </section>

      {/* Quick Setup */}
      <section className="mb-12">
        <h2 id="quick-setup" className="text-2xl font-semibold mb-4">Quick Setup</h2>

        <Steps
          steps={[
            {
              title: "Install Broski Link on your Mac",
              content: <CodeBlock language="bash">{`broski install`}</CodeBlock>,
            },
            {
              title: "Add your relay",
              description: "Put the relay URL in ~/.broski/link/config.json, then restart.",
              content: (
                <CodeBlock language="bash">{`# ~/.broski/link/config.json
# { "relay": "wss://relay.example.com" }

broski restart`}</CodeBlock>
              ),
            },
            {
              title: "Pair your phone",
              content: (
                <>
                  <CodeBlock language="bash">{`broski-link pair`}</CodeBlock>
                  <p className="text-sm text-muted-foreground mt-2">
                    Scan the QR code with Broski. It is single-use and expires after 10 minutes.
                  </p>
                </>
              ),
            },
          ]}
        />

        <SuccessStep
          title="You can now code from anywhere!"
          description="As long as your Mac is awake and online, Broski reaches it from any network."
        />

        <Callout type="info" title="Home network only?">
          If you only ever code on the same network as your Mac, you do not need a relay. Skip step
          2; the phone connects directly.
        </Callout>
      </section>

      {/* Tips */}
      <section className="mb-12">
        <h2 id="tips" className="text-2xl font-semibold mb-4">Tips</h2>

        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Connection drops when switching networks</div>
            <p className="text-sm text-muted-foreground">
              This is normal. The app reconnects on its own once your phone has a stable network
              again, trying the local network first and the relay second.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Check which route you are on</div>
            <CodeBlock language="bash">{`broski-link status`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">
              Each paired phone is listed with the route it is using (local network or relay).
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2">Lost your phone?</div>
            <CodeBlock language="bash">{`broski-link devices
broski-link revoke <device id prefix>`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-2">
              A revoked phone can no longer connect, by either route.
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
            ["Best latency", "Same network as your Mac (direct)"],
            ["Access from anywhere", "A relay in ~/.broski/link/config.json"],
            ["Nothing exposed to the internet", "Either route: the bridge only listens locally"],
          ]}
        />
      </section>

      {/* Related */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="related" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/bridge/remote-access" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Access (Technical)</h3>
            <p className="text-sm text-muted-foreground">How Broski Link routes and encrypts</p>
          </a>
          <a href="/docs/bridge/background-service" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Background Service</h3>
            <p className="text-sm text-muted-foreground">Run Broski Link automatically</p>
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
