import type { Metadata } from "next";
import { CodeBlock, SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Codex (OpenAI) - Broski",
  description: "Use GPT models with Broski via OpenCode",
};

export default function CodexPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="codex" className="text-3xl font-bold mb-3">Codex (OpenAI)</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Use GPT models with Broski via OpenCode.
      </p>

      <Callout type="info">
        GPT support is available through OpenCode&apos;s multi-provider system.
      </Callout>

      <h2 id="setup" className="text-xl font-semibold mb-4 mt-10">Setup</h2>
      
      <p className="text-sm text-muted-foreground mb-3">
        Get an API key from <a href="https://platform.openai.com" className="text-primary hover:underline">platform.openai.com</a>
      </p>

      <CodeBlock language="bash">{`export OPENAI_API_KEY=sk-your-key-here`}</CodeBlock>

      <h3 id="select-model" className="text-base font-medium mb-3 mt-6">Select Model</h3>
      <CodeBlock language="bash">{`opencode config set model "openai/gpt-4-turbo"`}</CodeBlock>

      <h2 id="models" className="text-xl font-semibold mb-4 mt-10">Models</h2>
      
      <SimpleTable
        headers={["Model", "Best For"]}
        rows={[
          [<code key="1">gpt-4-turbo</code>, "Complex tasks, long context"],
          [<code key="2">gpt-4o</code>, "Fast, multimodal"],
          [<code key="3">gpt-3.5-turbo</code>, "Quick tasks"],
          [<code key="4">o1</code>, "Reasoning tasks"],
        ]}
      />

      <h2 id="next-steps" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/backends/opencode" title="OpenCode" description="Multi-provider docs" />
        <Card href="/docs/backends/claude-code" title="Claude Code" description="Anthropic backend" />
      </CardGrid>
    </article>
  );
}
