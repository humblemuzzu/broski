import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";

export const metadata: Metadata = {
  title: "Environment Variables - Broski",
  description: "All environment variables supported by the Broski bridge",
};

export default function EnvVariablesPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="environment-variables" className="text-4xl font-bold mb-4">Environment Variables</h1>
      <p className="text-xl text-muted-foreground mb-8">
        All environment variables supported by the Broski bridge.
      </p>

      {/* Bridge Variables */}
      <section className="mb-12">
        <h2 id="bridge-vars" className="text-2xl font-semibold mb-4">Bridge Variables</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Variable</th>
                <th className="text-left p-3 border-b border-border">Type</th>
                <th className="text-left p-3 border-b border-border">Default</th>
                <th className="text-left p-3 border-b border-border">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">BROSKI_PORT</td>
                <td className="p-3 border-b border-border/50">number</td>
                <td className="p-3 border-b border-border/50">18274</td>
                <td className="p-3 border-b border-border/50">Bridge WebSocket port</td>
              </tr>

              <tr>
                <td className="p-3 font-mono text-xs">BROSKI_ENABLE_FUNNEL</td>
                <td className="p-3">1 or unset</td>
                <td className="p-3">unset</td>
                <td className="p-3">Enable Tailscale Funnel</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* OpenCode Variables */}
      <section className="mb-12">
        <h2 id="opencode-vars" className="text-2xl font-semibold mb-4">OpenCode Variables</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Variable</th>
                <th className="text-left p-3 border-b border-border">Type</th>
                <th className="text-left p-3 border-b border-border">Default</th>
                <th className="text-left p-3 border-b border-border">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">OPENCODE_BASE_URL</td>
                <td className="p-3 border-b border-border/50">string</td>
                <td className="p-3 border-b border-border/50">-</td>
                <td className="p-3 border-b border-border/50">URL of existing OpenCode server</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">BROSKI_OPENCODE_HOSTNAME</td>
                <td className="p-3 border-b border-border/50">string</td>
                <td className="p-3 border-b border-border/50">127.0.0.1</td>
                <td className="p-3 border-b border-border/50">Hostname for managed OpenCode</td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">BROSKI_OPENCODE_PORT</td>
                <td className="p-3">number</td>
                <td className="p-3">0</td>
                <td className="p-3">Port for managed OpenCode (0 = random)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* API Keys */}
      <section className="mb-12">
        <h2 id="api-keys" className="text-2xl font-semibold mb-4">API Keys</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-border rounded-lg">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-3 border-b border-border">Variable</th>
                <th className="text-left p-3 border-b border-border">Backend</th>
                <th className="text-left p-3 border-b border-border">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">ANTHROPIC_API_KEY</td>
                <td className="p-3 border-b border-border/50">Both</td>
                <td className="p-3 border-b border-border/50">Anthropic Claude API key</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">OPENAI_API_KEY</td>
                <td className="p-3 border-b border-border/50">OpenCode</td>
                <td className="p-3 border-b border-border/50">OpenAI API key</td>
              </tr>
              <tr>
                <td className="p-3 border-b border-border/50 font-mono text-xs">GOOGLE_AI_API_KEY</td>
                <td className="p-3 border-b border-border/50">OpenCode</td>
                <td className="p-3 border-b border-border/50">Google Gemini API key</td>
              </tr>
              <tr>
                <td className="p-3 font-mono text-xs">OPENROUTER_API_KEY</td>
                <td className="p-3">OpenCode</td>
                <td className="p-3">OpenRouter API key</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Setting Variables */}
      <section className="mb-12">
        <h2 id="setting" className="text-2xl font-semibold mb-4">Setting Environment Variables</h2>
        
        <h3 id="temporary" className="text-xl font-medium mb-3 mt-6">Temporary (Current Session)</h3>
        <CodeBlock language="bash">{`# Set for this command only
BROSKI_PORT=8080 broski

# Or export for current session
export ANTHROPIC_API_KEY=sk-ant-...
broski`}</CodeBlock>

        <h3 id="permanent" className="text-xl font-medium mb-3 mt-6">Permanent (Shell Profile)</h3>
        <CodeBlock language="bash">{`# Add to ~/.bashrc, ~/.zshrc, or ~/.profile
export ANTHROPIC_API_KEY=sk-ant-...
export BROSKI_PORT=18274

# Reload
source ~/.zshrc`}</CodeBlock>
      </section>

      {/* Precedence */}
      <section className="mb-12">
        <h2 id="precedence" className="text-2xl font-semibold mb-4">Precedence Order</h2>
        <p className="text-muted-foreground mb-4">
          When the same setting is configured in multiple places:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm">
          <li><strong>CLI flags</strong> - Highest priority</li>
          <li><strong>Environment variables</strong></li>
          <li><strong>Config files</strong></li>
          <li><strong>Default values</strong> - Lowest priority</li>
        </ol>
      </section>

      {/* Next Steps */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="next-steps" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/reference/cli" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">CLI Reference</h3>
            <p className="text-sm text-muted-foreground">All command-line options</p>
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
