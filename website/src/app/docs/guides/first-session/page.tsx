import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";
import { Steps, SuccessStep } from "@/components/docs/steps";

export const metadata: Metadata = {
  title: "Your First Session - Broski",
  description: "A complete walkthrough of your first coding session with Broski",
};

export default function FirstSessionPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="first-session" className="text-4xl font-bold mb-4">Your First Session</h1>
      <p className="text-xl text-muted-foreground mb-8">
        A complete walkthrough of your first coding session with Broski.
      </p>

      {/* Before You Start */}
      <section className="mb-12">
        <h2 id="before-you-start" className="text-2xl font-semibold mb-4">Before You Start</h2>
        <p className="text-muted-foreground mb-4">
          Make sure you have everything ready:
        </p>
        <SimpleTable
          headers={["Requirement", "How to Check"]}
          rows={[
            ["Bridge running on your system", "Terminal shows QR code and \"Bridge listening on port 18274\""],
            ["Phone connected", "Green connection indicator in the app"],
            ["AI backend configured", "Claude Code or Pi with valid API key"],
          ]}
        />

        <Callout type="tip" title="Not connected yet?">
          Follow the <a href="/docs/setup" className="text-primary hover:underline">setup guide</a> first, 
          then come back here.
        </Callout>
      </section>

      {/* Open a Project */}
      <section className="mb-12">
        <h2 id="open-project" className="text-2xl font-semibold mb-4">Step 1: Open a Project</h2>
        <Steps
          steps={[
            {
              title: "Go to the Projects tab",
              description: "Tap the grid icon in the bottom navigation bar",
            },
            {
              title: "Find your project",
              description: "Projects from your system's home directory appear here. Scroll or use the search bar.",
            },
            {
              title: "Tap to open",
              description: "Tap on a project card to create a new session in that directory.",
            },
          ]}
        />

        <Callout type="info" title="No projects showing?">
          The bridge scans your home directory for projects. Make sure your code is in a folder under 
          <code className="bg-muted/50 px-1 rounded mx-1">~</code> (e.g., <code className="bg-muted/50 px-1 rounded">~/Projects/myapp</code>).
        </Callout>
      </section>

      {/* Send Your First Message */}
      <section className="mb-12">
        <h2 id="send-message" className="text-2xl font-semibold mb-4">Step 2: Send Your First Message</h2>
        <p className="text-muted-foreground mb-4">
          Once you&apos;ve opened a project, you&apos;ll see the chat screen. Here&apos;s how to interact with your AI:
        </p>
        <Steps
          steps={[
            {
              title: "Tap the input field",
              description: "The text input is at the bottom of the screen. Tap to bring up the keyboard.",
            },
            {
              title: "Type your message",
              description: "Ask the AI to do something. For example: \"What files are in this project?\" or \"Explain what this codebase does\"",
            },
            {
              title: "Tap send",
              description: "Hit the send button (arrow icon) to submit your message.",
            },
            {
              title: "Watch the response stream",
              description: "The AI's response appears in real-time as it thinks and works.",
            },
          ]}
        />

        <h3 id="good-first-prompts" className="text-lg font-semibold mt-6 mb-3">Good First Prompts</h3>
        <div className="space-y-3">
          <div className="bg-muted/20 border border-border/50 rounded-lg p-3">
            <p className="text-sm font-medium">&quot;What is this project? Give me a brief overview.&quot;</p>
            <p className="text-xs text-muted-foreground mt-1">Great for understanding a new codebase</p>
          </div>
          <div className="bg-muted/20 border border-border/50 rounded-lg p-3">
            <p className="text-sm font-medium">&quot;Find all TODO comments in the codebase&quot;</p>
            <p className="text-xs text-muted-foreground mt-1">Useful for identifying work items</p>
          </div>
          <div className="bg-muted/20 border border-border/50 rounded-lg p-3">
            <p className="text-sm font-medium">&quot;Add a comment to the main function explaining what it does&quot;</p>
            <p className="text-xs text-muted-foreground mt-1">A simple edit to see how file changes work</p>
          </div>
        </div>
      </section>

      {/* Understanding Tool Calls */}
      <section className="mb-12">
        <h2 id="tool-calls" className="text-2xl font-semibold mb-4">Step 3: Understanding Tool Calls</h2>
        <p className="text-muted-foreground mb-4">
          When the AI needs to do something (read a file, run a command, edit code), it uses &quot;tools&quot;. 
          You&apos;ll see these as cards in the chat:
        </p>

        <SimpleTable
          headers={["Tool", "Icon", "What It Does"]}
          rows={[
            ["Read", "Document", "Reads file contents to understand your code"],
            ["Edit", "Pencil", "Modifies an existing file"],
            ["Write", "Plus-document", "Creates a new file"],
            ["Bash", "Terminal", "Runs a shell command"],
            ["Search", "Magnifying glass", "Searches for files or text"],
            ["Task", "Robot", "Delegates work to a sub-agent"],
          ]}
        />

        <h3 id="tool-card-anatomy" className="text-lg font-semibold mt-6 mb-3">Tool Card Anatomy</h3>
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">Reading src/main.ts</div>
              <div className="text-xs text-muted-foreground">Completed</div>
            </div>
            <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <p className="text-xs text-muted-foreground">
            Tap the card to expand and see details (file contents, command output, diff preview).
          </p>
        </div>
      </section>

      {/* Approve a Command */}
      <section className="mb-12">
        <h2 id="approve-command" className="text-2xl font-semibold mb-4">Step 4: Approve a Command</h2>
        <p className="text-muted-foreground mb-4">
          Some actions require your approval before they run. This keeps you in control:
        </p>

        <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <div className="font-medium text-sm">Permission Required</div>
              <div className="text-xs text-muted-foreground mt-1">The AI wants to run a shell command</div>
              <div className="bg-muted/30 rounded p-2 mt-2 font-mono text-xs">npm install lodash</div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="px-4 py-1.5 text-xs border border-red-500/50 text-red-500 rounded hover:bg-red-500/10">
              Deny
            </button>
            <button className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded">
              Approve
            </button>
          </div>
        </div>

        <Callout type="info" title="When do you need to approve?">
          <ul className="mt-2 space-y-1">
            <li>• <strong>Bash commands:</strong> Running shell commands</li>
            <li>• <strong>File edits:</strong> Modifying existing files (configurable)</li>
            <li>• <strong>Destructive operations:</strong> Deleting files, git operations</li>
          </ul>
        </Callout>

        <p className="text-muted-foreground mt-4">
          For more details, see the <a href="/docs/guides/approve-commands" className="text-primary hover:underline">Approving Commands guide</a>.
        </p>
      </section>

      {/* View the Results */}
      <section className="mb-12">
        <h2 id="view-results" className="text-2xl font-semibold mb-4">Step 5: View the Results</h2>
        <p className="text-muted-foreground mb-4">
          After the AI makes changes, you can review them:
        </p>

        <h3 id="viewing-diffs" className="text-lg font-semibold mt-4 mb-3">Viewing Diffs</h3>
        <p className="text-muted-foreground mb-4">
          When a file is edited, you&apos;ll see an inline diff:
        </p>
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/30 px-3 py-2 text-xs flex items-center gap-2 border-b border-border">
            <span className="font-medium">src/main.ts</span>
            <span className="text-[#7fd88f]">+3</span>
            <span className="text-red-400">-1</span>
          </div>
          <div className="p-3 font-mono text-xs space-y-1">
            <div className="text-muted-foreground">  function main() {`{`}</div>
            <div className="text-red-400 bg-red-500/10 px-1 -mx-1">-   console.log(&quot;Hello&quot;)</div>
            <div className="text-[#7fd88f] bg-[#7fd88f]/10 px-1 -mx-1">+   // Initialize the application</div>
            <div className="text-[#7fd88f] bg-[#7fd88f]/10 px-1 -mx-1">+   console.log(&quot;Starting app...&quot;)</div>
            <div className="text-[#7fd88f] bg-[#7fd88f]/10 px-1 -mx-1">+   init()</div>
            <div className="text-muted-foreground">  {`}`}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Red lines with <code>-</code> are removed. Green lines with <code>+</code> are added.
        </p>

        <h3 id="full-diff-view" className="text-lg font-semibold mt-6 mb-3">Full-Screen Diff</h3>
        <p className="text-muted-foreground mb-4">
          Tap &quot;View full&quot; on any diff card to open a full-screen diff viewer with:
        </p>
        <ul className="text-muted-foreground space-y-1">
          <li>• <strong>Split view:</strong> Before (left) and After (right) side by side</li>
          <li>• <strong>Unified view:</strong> Single column with changes marked</li>
          <li>• <strong>Syntax highlighting:</strong> Colored code for readability</li>
        </ul>

        <h3 id="undo-changes" className="text-lg font-semibold mt-6 mb-3">Undoing Changes</h3>
        <p className="text-muted-foreground mb-4">
          Don&apos;t like a change? You can undo it:
        </p>
        <ul className="text-muted-foreground space-y-1">
          <li>• Tap the &quot;Undo&quot; button on any edit tool card</li>
          <li>• Or type <code className="bg-muted/50 px-1 rounded">/undo</code> in the chat</li>
        </ul>
      </section>

      {/* End the Session */}
      <section className="mb-12">
        <h2 id="end-session" className="text-2xl font-semibold mb-4">Step 6: End the Session</h2>
        <p className="text-muted-foreground mb-4">
          Sessions are automatically saved. You can:
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li>• <strong>Leave anytime:</strong> Just navigate away. Your conversation is saved.</li>
          <li>• <strong>Resume later:</strong> Go to the Sessions tab to see all your conversations.</li>
          <li>• <strong>Delete if needed:</strong> Swipe left on a session to delete it.</li>
        </ul>

        <Callout type="info" title="What gets saved?">
          <ul className="mt-2 space-y-1">
            <li>• All messages (yours and the AI&apos;s)</li>
            <li>• Tool calls and their results</li>
            <li>• File diffs and changes</li>
            <li>• Token usage statistics</li>
          </ul>
          <p className="mt-2 text-xs">
            Note: The actual file changes on your system are persistent - they&apos;re saved to disk as they happen.
          </p>
        </Callout>
      </section>

      {/* Success! */}
      <section className="mb-12">
        <SuccessStep
          title="You've completed your first session!"
          description="You now know the basics of using Broski to chat with AI, approve commands, and review code changes."
        />
      </section>

      {/* What's Next */}
      <section className="mb-12">
        <h2 id="whats-next" className="text-2xl font-semibold mb-4">What&apos;s Next?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/guides/approve-commands" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Approving Commands</h3>
            <p className="text-sm text-muted-foreground">Learn about permission controls</p>
          </a>
          <a href="/docs/guides/remote-coding" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Remote Coding</h3>
            <p className="text-sm text-muted-foreground">Code from anywhere with a relay</p>
          </a>
        </div>
      </section>
    </article>
  );
}
