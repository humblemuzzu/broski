import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "FAQ - Broski",
  description: "Frequently asked questions about Broski",
};

export default function FAQPage() {
  return (
    <article className="max-w-3xl">
      <h1 className="text-4xl font-bold mb-4">Frequently Asked Questions</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Quick answers to common questions about Broski.
      </p>

      {/* General */}
      <section className="mb-12">
        <h2 id="general" className="text-2xl font-semibold mb-6">General</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What is Broski?</h3>
            <p className="text-muted-foreground">
              Broski is a mobile companion app that turns your phone into a remote control for AI coding agents. 
              It connects to Claude Code, OpenCode, or Codex running on your Mac, letting you chat with AI, 
              view code changes, and approve actions from anywhere.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Is Broski free?</h3>
            <p className="text-muted-foreground">
              Yes, Broski is completely free. However, you&apos;ll need your own AI provider subscription 
              (Claude Pro, OpenAI API key, etc.) configured in your AI backend - Broski doesn&apos;t handle AI authentication.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What platforms does Broski support?</h3>
            <p className="text-muted-foreground mb-3">
              <strong className="text-foreground">Mobile:</strong> iOS 15+ and Android 8+
            </p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Bridge Server:</strong> macOS 12+, Windows 10+, Linux (Ubuntu 20.04+)
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Do I need a computer to use Broski?</h3>
            <p className="text-muted-foreground">
              Yes. Broski is a companion app - the AI coding agent runs on your computer, and Broski 
              provides a mobile interface to interact with it. Your computer needs to be running 
              the bridge server for Broski to work.
            </p>
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="mb-12">
        <h2 id="setup" className="text-2xl font-semibold mb-6">Setup & Installation</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What do I need to get started?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; A Mac (or Windows/Linux PC)</li>
              <li>&#8226; Node.js 18+ or Bun installed</li>
              <li>&#8226; Claude Code, OpenCode, or Codex CLI installed</li>
              <li>&#8226; An AI provider account (Claude, OpenAI, etc.)</li>
              <li>&#8226; An iPhone or iPad (iOS 15+) or Android device</li>
              <li>&#8226; Same WiFi network OR Tailscale for remote access</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I install the bridge?</h3>
            <p className="text-muted-foreground mb-3">
              Run one of these commands in your terminal:
            </p>
            <CodeBlock language="bash">{`bunx broski`}</CodeBlock>
            <p className="text-muted-foreground text-sm mt-2">
              Or with npm:
            </p>
            <CodeBlock language="bash">{`npx broski`}</CodeBlock>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Why can&apos;t I scan the QR code?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; Make sure your phone and Mac are on the same WiFi network</li>
              <li>&#8226; Check that the bridge is still running in your terminal</li>
              <li>&#8226; Try increasing terminal brightness</li>
              <li>&#8226; Move closer to the screen for better camera focus</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Connection */}
      <section className="mb-12">
        <h2 id="connection" className="text-2xl font-semibold mb-6">Connection</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Do I need to be on the same WiFi?</h3>
            <p className="text-muted-foreground">
              For local connections, yes. For remote access from anywhere, set up Tailscale 
              (free) on both your Mac and phone - then you can use Broski from any location.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What is Tailscale and why do I need it?</h3>
            <p className="text-muted-foreground">
              Tailscale is a free VPN that creates a secure connection between your devices. 
              Without it, you can only use Broski when connected to the same WiFi as your Mac. 
              With Tailscale, you can use Broski from a coffee shop, airport, or anywhere in the world.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Why does my connection keep dropping?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; Check your WiFi signal strength</li>
              <li>&#8226; The bridge may have crashed - restart it</li>
              <li>&#8226; Keep the app in foreground (iOS may kill background apps)</li>
              <li>&#8226; If using Tailscale, verify both devices are connected</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Is my data secure?</h3>
            <p className="text-muted-foreground">
              Yes. Broski uses peer-to-peer connections - your code never passes through our servers. 
              All communication stays on your local network or your Tailscale VPN. We don&apos;t 
              collect any data.
            </p>
          </div>
        </div>
      </section>

      {/* AI Backends */}
      <section className="mb-12">
        <h2 id="ai-backends" className="text-2xl font-semibold mb-6">AI Backends</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What&apos;s the difference between OpenCode and Claude Code?</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-muted-foreground mt-3">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="text-left py-2 text-foreground">Aspect</th>
                    <th className="text-left py-2 text-foreground">OpenCode</th>
                    <th className="text-left py-2 text-foreground">Claude Code</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/30">
                    <td className="py-2">Creator</td>
                    <td className="py-2">Open source</td>
                    <td className="py-2">Anthropic (official)</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2">AI Providers</td>
                    <td className="py-2">17+ (Claude, GPT, Gemini, etc.)</td>
                    <td className="py-2">Claude only</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-2">MCP Support</td>
                    <td className="py-2">Full</td>
                    <td className="py-2">Yes</td>
                  </tr>
                  <tr>
                    <td className="py-2">Best for</td>
                    <td className="py-2">Multi-provider flexibility</td>
                    <td className="py-2">Claude-only users</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What is Codex?</h3>
            <p className="text-muted-foreground">
              Codex is OpenAI&apos;s CLI agent. Broski supports it as a third backend option, 
              allowing you to use GPT models for coding assistance.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I switch between backends?</h3>
            <p className="text-muted-foreground">
              Yes! Go to Settings &gt; AI Backend in the app to switch between Claude Code, 
              OpenCode, and Codex. The bridge will reconnect with the selected backend.
            </p>
          </div>
        </div>
      </section>

      {/* Usage */}
      <section className="mb-12">
        <h2 id="usage" className="text-2xl font-semibold mb-6">Using the App</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">What can I do with Broski?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; Chat with AI in real-time with streaming responses</li>
              <li>&#8226; Review code diffs before they&apos;re applied</li>
              <li>&#8226; Approve or reject file changes and commands</li>
              <li>&#8226; Switch between projects and sessions</li>
              <li>&#8226; Browse files and search your codebase</li>
              <li>&#8226; View AI thinking and tool execution</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Can I use Broski offline?</h3>
            <p className="text-muted-foreground">
              Partially. You can view cached sessions and messages offline, but you need 
              an active connection to the bridge to send new messages or interact with AI.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I attach images to messages?</h3>
            <p className="text-muted-foreground">
              Tap the attachment button in the chat input bar. You can take a photo 
              or select from your photo library. The AI can analyze images and use 
              them as context for your requests.
            </p>
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="mb-12">
        <h2 id="privacy" className="text-2xl font-semibold mb-6">Privacy & Security</h2>
        
        <div className="space-y-6">
          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Does Broski collect my data?</h3>
            <p className="text-muted-foreground">
              No. Broski uses peer-to-peer connections. Your code and conversations 
              never pass through our servers. We don&apos;t collect analytics, usage data, 
              or any personal information.
            </p>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">Where is my data stored?</h3>
            <ul className="text-muted-foreground space-y-2">
              <li>&#8226; <strong className="text-foreground">Connection credentials:</strong> Encrypted in iOS Keychain</li>
              <li>&#8226; <strong className="text-foreground">Cached sessions:</strong> On your device only</li>
              <li>&#8226; <strong className="text-foreground">AI conversations:</strong> On your Mac (handled by AI backend)</li>
            </ul>
          </div>

          <div className="border border-border/50 rounded-lg p-5">
            <h3 className="font-semibold mb-2">How do I delete my data?</h3>
            <p className="text-muted-foreground">
              Go to Settings &gt; Clear Cache to delete all cached data from the app. 
              Uninstalling the app removes all data from your device.
            </p>
          </div>
        </div>
      </section>

      {/* Still have questions */}
      <section className="bg-card/50 border border-border/50 rounded-lg p-6">
        <h2 id="help" className="text-xl font-semibold mb-3">Still have questions?</h2>
        <p className="text-muted-foreground mb-4">
          We&apos;re here to help. Reach out through any of these channels:
        </p>
        <div className="flex flex-wrap gap-3">
          <a 
            href="mailto:broskiappp@gmail.com"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Email Support
          </a>
          <a 
            href="/docs/troubleshooting"
            className="inline-flex items-center gap-2 px-4 py-2 border border-border/50 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Troubleshooting Guide
          </a>
        </div>
      </section>
    </article>
  );
}
