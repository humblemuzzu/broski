import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "CLI Reference - Broski",
  description: "Complete reference for all broski command-line options",
};

export default function CLIReferencePage() {
  return (
    <article className="max-w-3xl">
      <h1 id="cli-reference" className="text-4xl font-bold mb-4">CLI Reference</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Complete reference for all broski command-line options.
      </p>

      {/* Basic Usage */}
      <section className="mb-12">
        <h2 id="usage" className="text-2xl font-semibold mb-4">Basic Usage</h2>
        <CodeBlock language="bash">{`broski [command] [options]`}</CodeBlock>
      </section>

      {/* Commands */}
      <section className="mb-12">
        <h2 id="commands" className="text-2xl font-semibold mb-4">Commands</h2>
        
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">broski</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Start the bridge server (default command).
            </p>
            <CodeBlock language="bash">{`broski [options]`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">broski doctor</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Run diagnostics to check system requirements and configuration.
            </p>
            <CodeBlock language="bash">{`broski doctor`}</CodeBlock>
            <p className="text-sm text-muted-foreground mt-3">
              Checks: AI backend installation, local IP, port availability, Tailscale status.
            </p>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h3 className="font-mono font-medium mb-2">broski setup-tailscale</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Interactive wizard to install and configure Tailscale.
            </p>
            <CodeBlock language="bash">{`broski setup-tailscale`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Options */}
      <section className="mb-12">
        <h2 id="options" className="text-2xl font-semibold mb-4">Options</h2>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Option</th>
                <th className="text-left p-3 border-b border-border">Description</th>
                <th className="text-left p-3 border-b border-border">Default</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--port &lt;n&gt;</td>
                <td className="p-3 border-b border-border/50">WebSocket port for the bridge</td>
                <td className="p-3 border-b border-border/50">18274</td>
              </tr>

              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--funnel</td>
                <td className="p-3 border-b border-border/50">Enable Tailscale Funnel (public HTTPS)</td>
                <td className="p-3 border-b border-border/50">false</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--new-token</td>
                <td className="p-3 border-b border-border/50">Generate new auth token</td>
                <td className="p-3 border-b border-border/50">false</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--managed</td>
                <td className="p-3 border-b border-border/50">Start and manage OpenCode (default)</td>
                <td className="p-3 border-b border-border/50">true</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--manual</td>
                <td className="p-3 border-b border-border/50">Connect to existing OpenCode server</td>
                <td className="p-3 border-b border-border/50">false</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--attach</td>
                <td className="p-3 border-b border-border/50">Scan and attach to running OpenCode</td>
                <td className="p-3 border-b border-border/50">false</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">--opencode-url &lt;url&gt;</td>
                <td className="p-3 border-b border-border/50">URL of existing OpenCode server</td>
                <td className="p-3 border-b border-border/50">-</td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">--help, -h</td>
                <td className="p-3">Show help message</td>
                <td className="p-3">-</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Examples */}
      <section className="mb-12">
        <h2 id="examples" className="text-2xl font-semibold mb-4">Examples</h2>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Start with defaults</h4>
            <CodeBlock language="bash">{`broski`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Custom port</h4>
            <CodeBlock language="bash">{`broski --port 8080`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Enable Tailscale Funnel</h4>
            <CodeBlock language="bash">{`broski --funnel`}</CodeBlock>
          </div>

          <div className="border border-border rounded-lg p-4">
            <h4 className="font-medium mb-2">Connect to existing OpenCode</h4>
            <CodeBlock language="bash">{`broski --opencode-url http://localhost:4096`}</CodeBlock>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/reference/env" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Environment Variables</h3>
            <p className="text-sm text-muted-foreground">All environment variable options</p>
          </a>
          <a href="/docs/bridge/configuration" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Configuration</h3>
            <p className="text-sm text-muted-foreground">Full configuration reference</p>
          </a>
        </div>
      </section>
    </article>
  );
}
