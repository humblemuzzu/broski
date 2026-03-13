import type { Metadata } from "next";
import { CodeBlock, SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Pi - Broski",
  description: "Pi coding agent — multi-provider, extensible, open source",
};

export default function PiPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="pi" className="text-3xl font-bold mb-3">Pi</h1>
      <p className="text-lg text-muted-foreground mb-8">
        An open-source, multi-provider coding agent with a powerful extension system.
      </p>

      <h2 id="what-is-pi" className="text-xl font-semibold mb-4">What is Pi?</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Pi is an open-source AI coding agent built on a modular architecture. Unlike single-provider agents,
        Pi connects to any AI provider &mdash; Anthropic, OpenAI, Google, Groq, Mistral, Ollama, or any 
        OpenAI-compatible endpoint. It features a rich extension system, built-in skills, and a session tree 
        that lets you fork and navigate conversation branches.
      </p>

      <Callout type="info">
        Pi is a separate project from OpenCode. While both support multiple providers, Pi has its own 
        extension system, skill framework, and session management with conversation tree navigation.
      </Callout>

      <h2 id="features" className="text-xl font-semibold mb-4 mt-10">Key Features</h2>

      <div className="grid gap-3 mb-8">
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Multi-Provider</div>
          <p className="text-xs text-muted-foreground">
            Use any AI provider: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Groq, Mistral, 
            Ollama, or any OpenAI-compatible API. Switch models mid-session.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Extension System</div>
          <p className="text-xs text-muted-foreground">
            Extend Pi with custom tools, commands, and UI elements via the extension API. 
            Extensions can register tools, add commands, and show dialogs on your phone.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Session Tree &amp; Forking</div>
          <p className="text-xs text-muted-foreground">
            Navigate your conversation as a tree. Fork from any point to explore different approaches 
            without losing context. Export sessions to HTML.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Built-in Skills</div>
          <p className="text-xs text-muted-foreground">
            Pi includes skills for git workflows, code review, documentation, investigation, 
            and more &mdash; loaded on demand to keep context focused.
          </p>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Smart Context Management</div>
          <p className="text-xs text-muted-foreground">
            Auto-compaction keeps sessions within context limits. Configurable reserve tokens, 
            retry policies, and thinking budgets per model.
          </p>
        </div>
      </div>

      <h2 id="setup" className="text-xl font-semibold mb-4 mt-10">Setup</h2>
      
      <h3 id="step-1" className="text-base font-medium mb-3 mt-6">1. Install Pi</h3>
      <CodeBlock language="bash">{`npm i -g @mariozechner/pi-coding-agent`}</CodeBlock>

      <h3 id="step-2" className="text-base font-medium mb-3 mt-6">2. Configure a Provider</h3>
      <p className="text-sm text-muted-foreground mb-3">
        Pi needs at least one AI provider API key. Set the environment variable for your preferred provider:
      </p>
      <CodeBlock language="bash">{`# Anthropic (Claude)
export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (GPT)
export OPENAI_API_KEY=sk-...

# Google (Gemini)
export GOOGLE_GENERATIVE_AI_API_KEY=...

# Groq
export GROQ_API_KEY=gsk_...

# Or any OpenAI-compatible endpoint
export OPENAI_API_BASE=http://localhost:11434/v1
export OPENAI_API_KEY=ollama`}</CodeBlock>

      <h3 id="step-3" className="text-base font-medium mb-3 mt-6">3. Start Broski</h3>
      <CodeBlock language="bash">{`broski`}</CodeBlock>
      <p className="text-sm text-muted-foreground mt-3">
        Select Pi as your backend in the Broski app settings.
      </p>

      <h2 id="providers" className="text-xl font-semibold mb-4 mt-10">Supported Providers</h2>

      <SimpleTable
        headers={["Provider", "Models", "API Key Variable"]}
        rows={[
          ["Anthropic", "Claude 4 Sonnet, Claude 4 Opus, Claude 3.5 Sonnet", "ANTHROPIC_API_KEY"],
          ["OpenAI", "GPT-4o, GPT-4o mini, o1, o3", "OPENAI_API_KEY"],
          ["Google", "Gemini 2.5 Pro, Gemini 2.5 Flash", "GOOGLE_GENERATIVE_AI_API_KEY"],
          ["Groq", "Llama, Mixtral", "GROQ_API_KEY"],
          ["Mistral", "Mistral Large, Codestral", "MISTRAL_API_KEY"],
          ["Ollama", "Any local model", "OPENAI_API_BASE + OPENAI_API_KEY"],
        ]}
      />

      <Callout type="tip">
        You can switch models mid-session from the model picker in the Broski app. 
        Pi dynamically discovers available models from your configured providers.
      </Callout>

      <h2 id="thinking" className="text-xl font-semibold mb-4 mt-10">Thinking Levels</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Pi supports configurable thinking levels for models that support extended thinking 
        (Claude, o1/o3, Gemini). Toggle thinking from the chat overflow menu in Broski.
      </p>

      <SimpleTable
        headers={["Level", "Description", "Best For"]}
        rows={[
          ["Off", "No extended thinking", "Fast responses, simple tasks"],
          ["Low", "Brief reasoning", "Standard coding tasks"],
          ["High", "Deep reasoning", "Complex architecture, debugging"],
        ]}
      />

      <h2 id="extensions" className="text-xl font-semibold mb-4 mt-10">Extensions</h2>
      
      <p className="text-sm text-muted-foreground mb-4">
        Pi&apos;s extension system lets you add custom tools, commands, and UI interactions. 
        Extensions are loaded from your project or global configuration.
      </p>

      <CodeBlock language="bash">{`# Extensions are configured in Pi settings
# View available extensions in Broski:
# Chat menu → Skills/Commands`}</CodeBlock>

      <h2 id="sessions" className="text-xl font-semibold mb-4 mt-10">Session Management</h2>

      <p className="text-sm text-muted-foreground mb-4">
        Pi sessions are stored locally and support tree-based navigation:
      </p>

      <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside mb-6">
        <li><strong className="text-foreground">Fork:</strong> Branch from any message to explore alternatives</li>
        <li><strong className="text-foreground">Navigate:</strong> Move between branches in the session sidebar</li>
        <li><strong className="text-foreground">Compact:</strong> Auto or manual context compaction to stay within limits</li>
        <li><strong className="text-foreground">Export:</strong> Export sessions to HTML for sharing or archiving</li>
      </ul>

      <h2 id="comparison" className="text-xl font-semibold mb-4 mt-10">Pi vs Other Backends</h2>

      <SimpleTable
        headers={["Feature", "Pi", "Claude Code", "OpenCode", "Codex"]}
        rows={[
          ["Providers", "Multi (any)", "Anthropic only", "75+ providers", "OpenAI only"],
          ["Open Source", "Yes", "No", "Yes", "Yes"],
          ["Extensions", "Yes (plugin API)", "Plugins", "Plugins", "Apps"],
          ["Session Tree", "Yes (fork/navigate)", "No", "No", "No"],
          ["HTML Export", "Yes", "No", "No", "No"],
          ["MCP Support", "No", "Yes", "Full", "Yes"],
          ["Sandbox", "No", "No", "No", "Yes (built-in)"],
          ["Thinking Levels", "Configurable", "Presets", "Variants", "Reasoning effort"],
        ]}
      />

      <h2 id="troubleshooting" className="text-xl font-semibold mb-4 mt-10">Troubleshooting</h2>

      <div className="space-y-4 mb-8">
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">&quot;Pi not found&quot;</div>
          <CodeBlock language="bash">{`# Install Pi globally
npm i -g @mariozechner/pi-coding-agent

# Verify installation
which pi
pi --version`}</CodeBlock>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">No models available</div>
          <p className="text-xs text-muted-foreground mb-2">
            Pi needs at least one provider API key configured. Check your environment variables:
          </p>
          <CodeBlock language="bash">{`echo $ANTHROPIC_API_KEY
echo $OPENAI_API_KEY
echo $GOOGLE_GENERATIVE_AI_API_KEY`}</CodeBlock>
        </div>
        <div className="p-4 rounded-lg border border-border/40 bg-card/30">
          <div className="font-medium mb-2 text-sm">Context too long</div>
          <p className="text-xs text-muted-foreground">
            Use the compact command from the chat menu, or enable auto-compaction in Pi settings. 
            You can also fork the session to start fresh with a summary.
          </p>
        </div>
      </div>

      <Callout type="tip">
        Run <code className="bg-muted/50 px-1 rounded">broski doctor --profile agents</code> to 
        verify Pi is correctly detected and configured.
      </Callout>
    </article>
  );
}
