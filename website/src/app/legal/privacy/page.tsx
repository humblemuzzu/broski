import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - Broski",
  description: "Broski Privacy Policy - How we handle your data",
};

export default function PrivacyPolicyPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-muted-foreground mb-8">Last updated: January 14, 2026</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Overview</h2>
        <p className="text-muted-foreground leading-relaxed">
          Broski is a mobile companion app for AI coding assistants. Your privacy is our priority. 
          This policy explains how we handle your data.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">What We Collect</h2>
        <div className="bg-card/50 border border-border/50 rounded-lg p-6 mb-4">
          <p className="text-primary font-semibold text-lg mb-2">Nothing.</p>
          <p className="text-muted-foreground">
            Broski does not collect, store, or transmit any personal data to our servers.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">How It Works</h2>
        <ul className="space-y-3 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>Broski connects directly to <strong className="text-foreground">your Mac</strong> via peer-to-peer connection</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>All communication stays on <strong className="text-foreground">your network</strong> (or via Tailscale VPN you control)</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>No data passes through Broski servers</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-primary mt-1">&#8226;</span>
            <span>No analytics, no tracking, no telemetry</span>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">What Stays on Your Device</h2>
        <p className="text-muted-foreground mb-4">
          The following data is stored locally on your device only:
        </p>
        <ul className="space-y-2 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span><strong className="text-foreground">Connection credentials</strong> - Encrypted in iOS Keychain</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span><strong className="text-foreground">Cached sessions</strong> - For offline viewing</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-accent mt-1">&#8226;</span>
            <span><strong className="text-foreground">App preferences</strong> - Theme, settings</span>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Third-Party Services</h2>
        <p className="text-muted-foreground">
          Broski connects to AI services (Claude Code, OpenCode, Codex) that run on <strong className="text-foreground">your Mac</strong>. 
          We do not operate these services. Please refer to their respective privacy policies:
        </p>
        <ul className="mt-4 space-y-2 text-muted-foreground">
          <li>
            <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Anthropic (Claude) Privacy Policy
            </a>
          </li>
          <li>
            <a href="https://openai.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              OpenAI (Codex) Privacy Policy
            </a>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Your Rights</h2>
        <ul className="space-y-2 text-muted-foreground">
          <li className="flex items-start gap-3">
            <span className="text-[#7fd88f] mt-1">&#8226;</span>
            <span><strong className="text-foreground">Delete your data</strong> - Use Settings &gt; Clear Cache in the app</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-[#7fd88f] mt-1">&#8226;</span>
            <span><strong className="text-foreground">Revoke connection</strong> - Disconnect anytime in Settings</span>
          </li>
          <li className="flex items-start gap-3">
            <span className="text-[#7fd88f] mt-1">&#8226;</span>
            <span><strong className="text-foreground">Uninstall</strong> - Removes all app data from your device</span>
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Children&apos;s Privacy</h2>
        <p className="text-muted-foreground">
          Broski is not intended for children under 17. We do not knowingly collect any information 
          from children.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Changes to This Policy</h2>
        <p className="text-muted-foreground">
          We may update this privacy policy from time to time. We will notify you of any changes 
          by posting the new policy on this page and updating the &quot;Last updated&quot; date.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Contact Us</h2>
        <p className="text-muted-foreground">
          If you have any questions about this Privacy Policy, please contact us:
        </p>
        <p className="mt-4">
          <a href="mailto:broskiappp@gmail.com" className="text-primary hover:underline">
            broskiappp@gmail.com
          </a>
        </p>
      </section>
    </article>
  );
}
