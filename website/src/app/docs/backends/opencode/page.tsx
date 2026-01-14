import type { Metadata } from "next";
import { CodeBlock, SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "OpenCode - Broski",
  description: "Multi-provider AI coding agent",
};

export default function OpenCodePage() {
  return (
    <article className="max-w-2xl">
      <h1 id="opencode" className="text-3xl font-bold mb-3">OpenCode</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Multi-provider AI coding agent. Default backend for Broski.
      </p>

      <CardGrid>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <h3 className="font-medium mb-2 text-sm">Providers</h3>
          <p className="text-xs text-muted-foreground">
            Anthropic, OpenAI, Google, OpenRouter, Mistral, Groq
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <h3 className="font-medium mb-2 text-sm">Features</h3>
          <p className="text-xs text-muted-foreground">
            MCP support, session management, file tools
          </p>
        </div>
      </CardGrid>

      <h2 id="setup" className="text-xl font-semibold mb-4 mt-10">Setup</h2>
      
      <CodeBlock language="bash">{`npm install -g opencode
opencode --version`}</CodeBlock>

      <h3 id="configure" className="text-base font-medium mb-3 mt-6">Configure Provider</h3>
      <CodeBlock language="bash">{`export ANTHROPIC_API_KEY=sk-ant-your-key-here
opencode config set model "anthropic/claude-sonnet-4-20250514"`}</CodeBlock>

      <h2 id="tools" className="text-xl font-semibold mb-4 mt-10">Tools</h2>
      
      <SimpleTable
        headers={["Tool", "Description", "Permission"]}
        rows={[
          [<code key="1">read</code>, "Read file contents", "Safe"],
          [<code key="2">write</code>, "Create files", <strong key="s2">Requires Approval</strong>],
          [<code key="3">edit</code>, "Modify files", <strong key="s3">Requires Approval</strong>],
          [<code key="4">glob</code>, "Find files", "Safe"],
          [<code key="5">bash</code>, "Shell commands", <strong key="s5">Requires Approval</strong>],
        ]}
      />

      <h2 id="troubleshooting" className="text-xl font-semibold mb-4 mt-10">Troubleshooting</h2>
      
      <Callout type="warning" title="Port conflict">
        If port 4096 is in use, run: <code>OPENCODE_PORT=4097 opencode</code>
      </Callout>

      <h2 id="next-steps" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/backends/claude-code" title="Claude Code" description="Anthropic backend" />
        <Card href="/docs/backends/codex" title="Codex" description="OpenAI GPT models" />
      </CardGrid>
    </article>
  );
}
