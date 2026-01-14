import type { Metadata } from "next";
import { CodeBlock, SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Claude Code - Broski",
  description: "Anthropic's official AI coding agent",
};

export default function ClaudeCodePage() {
  return (
    <article className="max-w-2xl">
      <h1 id="claude-code" className="text-3xl font-bold mb-3">Claude Code</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Anthropic&apos;s official AI coding agent.
      </p>

      <h2 id="setup" className="text-xl font-semibold mb-4">Setup</h2>
      
      <h3 id="installation" className="text-base font-medium mb-3 mt-6">Installation</h3>
      <CodeBlock language="bash">{`npm install -g @anthropic-ai/claude-code

claude --version`}</CodeBlock>

      <h3 id="authentication" className="text-base font-medium mb-3 mt-6">Authentication</h3>
      
      <Callout type="note" title="Option A: API Key">
        Set your Anthropic API key as an environment variable.
      </Callout>
      <CodeBlock language="bash">{`export ANTHROPIC_API_KEY=sk-ant-your-key-here
bunx broski`}</CodeBlock>

      <Callout type="note" title="Option B: OAuth Login">
        Use browser-based authentication.
      </Callout>
      <CodeBlock language="bash">{`claude login
bunx broski`}</CodeBlock>

      <h2 id="permission-modes" className="text-xl font-semibold mb-4 mt-10">Permission Modes</h2>
      
      <SimpleTable
        headers={["Mode", "Behavior"]}
        rows={[
          [<code key="1">default</code>, "Ask for file edits and shell commands"],
          [<code key="2">acceptEdits</code>, "Auto-approve edits, ask for bash"],
          [<code key="3">plan</code>, "Read-only mode"],
          [<code key="4">bypassPermissions</code>, "Skip all checks"],
        ]}
      />

      <h2 id="tools" className="text-xl font-semibold mb-4 mt-10">Tools</h2>
      
      <SimpleTable
        headers={["Tool", "Description", "Permission"]}
        rows={[
          [<code key="1">Read</code>, "Read file contents", "Safe"],
          [<code key="2">Write</code>, "Create files", <strong key="s2">Requires Approval</strong>],
          [<code key="3">Edit</code>, "Modify files", <strong key="s3">Requires Approval</strong>],
          [<code key="4">Bash</code>, "Shell commands", <strong key="s4">Requires Approval</strong>],
          [<code key="5">Glob</code>, "Find files", "Safe"],
          [<code key="6">Grep</code>, "Search contents", "Safe"],
        ]}
      />

      <h2 id="troubleshooting" className="text-xl font-semibold mb-4 mt-10">Troubleshooting</h2>
      
      <Callout type="warning" title="Auth not configured">
        No valid authentication found. Set <code>ANTHROPIC_API_KEY</code> or run <code>claude login</code>.
      </Callout>

      <h2 id="next-steps" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/backends/opencode" title="OpenCode" description="Multi-provider backend" />
        <Card href="/docs/troubleshooting/ai-backends" title="Troubleshooting" description="Backend issues" />
      </CardGrid>
    </article>
  );
}
