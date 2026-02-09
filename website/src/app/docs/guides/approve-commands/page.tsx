import type { Metadata } from "next";
import { SimpleTable } from "@/components/docs/docs-table";
import { Callout } from "@/components/docs/callout";
import { Steps } from "@/components/docs/steps";

export const metadata: Metadata = {
  title: "Approving Commands - Broski",
  description: "Learn how to safely approve AI actions and configure auto-approve settings",
};

export default function ApproveCommandsPage() {
  return (
    <article className="max-w-3xl">
      <h1 id="approve-commands" className="text-4xl font-bold mb-4">Approving Commands</h1>
      <p className="text-xl text-muted-foreground mb-8">
        Learn how to safely approve AI actions and configure auto-approve settings.
      </p>

      {/* Why Approvals Exist */}
      <section className="mb-12">
        <h2 id="why-approvals" className="text-2xl font-semibold mb-4">Why Approvals Exist</h2>
        <p className="text-muted-foreground mb-4">
          AI coding assistants are powerful, but they can make mistakes. The approval system gives you:
        </p>
        <ul className="text-muted-foreground space-y-3">
          <li className="flex gap-3">
            <span className="text-primary">●</span>
            <div>
              <strong className="text-foreground">Safety:</strong> Review destructive operations before they run 
              (deleting files, running scripts, git operations)
            </div>
          </li>
          <li className="flex gap-3">
            <span className="text-primary">●</span>
            <div>
              <strong className="text-foreground">Control:</strong> You decide what the AI can do autonomously 
              and what needs your approval
            </div>
          </li>
          <li className="flex gap-3">
            <span className="text-primary">●</span>
            <div>
              <strong className="text-foreground">Awareness:</strong> See exactly what&apos;s happening on your 
              system, even when you&apos;re not at your desk
            </div>
          </li>
        </ul>
      </section>

      {/* What Needs Approval */}
      <section className="mb-12">
        <h2 id="what-needs-approval" className="text-2xl font-semibold mb-4">What Needs Approval?</h2>
        <p className="text-muted-foreground mb-4">
          By default, these actions require your approval:
        </p>
        <SimpleTable
          headers={["Action", "Why It Needs Approval", "Risk Level"]}
          rows={[
            ["Bash commands", "Can run any shell command on your system", "High"],
            ["File edits", "Modifies existing code (configurable)", "Medium"],
            ["File creation", "Creates new files in your project", "Low"],
            ["Git operations", "Commits, pushes, or modifies git history", "High"],
            ["Package installs", "npm install, pip install, etc.", "Medium"],
            ["Destructive ops", "rm, unlink, truncate, etc.", "Critical"],
          ]}
        />

        <Callout type="info" title="Read-only operations are auto-approved">
          Tools like Read, Search, and Glob don&apos;t modify anything, so they run automatically 
          without asking. This keeps the flow smooth while you stay safe.
        </Callout>
      </section>

      {/* The Approval Card */}
      <section className="mb-12">
        <h2 id="approval-card" className="text-2xl font-semibold mb-4">The Approval Card</h2>
        <p className="text-muted-foreground mb-4">
          When the AI wants to do something that needs your approval, you&apos;ll see a card like this:
        </p>

        {/* Mock approval card */}
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="flex-1">
              <div className="font-medium text-sm">Permission Required</div>
              <div className="text-xs text-muted-foreground mt-1">The AI wants to run a shell command</div>
              <div className="bg-muted/30 rounded p-2 mt-2 font-mono text-xs overflow-x-auto">
                git add . && git commit -m &quot;Fix login bug&quot;
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4 ml-8">
            <button className="px-4 py-1.5 text-xs border border-red-500/50 text-red-500 rounded">
              Deny
            </button>
            <button className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded">
              Approve
            </button>
          </div>
        </div>

        <h3 id="card-elements" className="text-lg font-semibold mb-3">Card Elements</h3>
        <SimpleTable
          headers={["Element", "Description"]}
          rows={[
            ["Warning icon", "Indicates this action needs your review"],
            ["Title", "\"Permission Required\" or similar"],
            ["Description", "What the AI wants to do"],
            ["Details", "The exact command, diff preview, or file path"],
            ["Deny button", "Reject the action (AI will be told you denied it)"],
            ["Approve button", "Allow the action to proceed"],
          ]}
        />

        <h3 id="diff-preview" className="text-lg font-semibold mt-6 mb-3">Diff Preview for File Edits</h3>
        <p className="text-muted-foreground mb-4">
          For file edits, the approval card shows a diff preview so you can see exactly what will change:
        </p>
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <div className="flex-1">
              <div className="font-medium text-sm">Edit: src/utils.ts</div>
              <div className="bg-muted/30 rounded p-2 mt-2 font-mono text-xs space-y-0.5">
                <div className="text-muted-foreground">  export function formatDate(date: Date) {`{`}</div>
                <div className="text-red-400">-   return date.toString()</div>
                <div className="text-[#7fd88f]">+   return date.toISOString().split(&apos;T&apos;)[0]</div>
                <div className="text-muted-foreground">  {`}`}</div>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4 ml-8">
            <button className="px-4 py-1.5 text-xs border border-red-500/50 text-red-500 rounded">Deny</button>
            <button className="px-4 py-1.5 text-xs bg-primary text-primary-foreground rounded">Approve</button>
          </div>
        </div>
      </section>

      {/* How to Respond */}
      <section className="mb-12">
        <h2 id="how-to-respond" className="text-2xl font-semibold mb-4">How to Respond</h2>
        <Steps
          steps={[
            {
              title: "Review the request",
              description: "Read what the AI wants to do. For commands, check the exact syntax. For edits, review the diff.",
            },
            {
              title: "Make your decision",
              description: "If it looks correct and safe, tap Approve. If something seems wrong, tap Deny.",
            },
            {
              title: "AI continues or adapts",
              description: "After approval, the action runs. After denial, the AI is notified and may suggest an alternative.",
            },
          ]}
        />

        <Callout type="warning" title="When to deny">
          <ul className="mt-2 space-y-1">
            <li>• Command looks suspicious or unfamiliar</li>
            <li>• Diff changes code you didn&apos;t expect</li>
            <li>• Operation seems too broad (e.g., <code className="bg-muted/50 px-1 rounded">rm -rf</code>)</li>
            <li>• You want to do it differently</li>
          </ul>
        </Callout>
      </section>

      {/* Always Allow */}
      <section className="mb-12">
        <h2 id="always-allow" className="text-2xl font-semibold mb-4">Always Allow (Auto-Approve)</h2>
        <p className="text-muted-foreground mb-4">
          For trusted tools you use frequently, you can enable auto-approve:
        </p>

        <h3 id="permission-modes" className="text-lg font-semibold mb-3">Permission Modes</h3>
        <SimpleTable
          headers={["Mode", "Description", "Best For"]}
          rows={[
            ["default", "Ask for all potentially dangerous operations", "New users, careful workflows"],
            ["plan", "Auto-approve planning/analysis tools", "When you trust the AI to explore"],
            ["auto-edit", "Auto-approve file edits (still asks for bash)", "Faster coding, you review via git"],
            ["allowAll", "Auto-approve everything (use with caution!)", "Trusted, isolated environments"],
          ]}
        />

        <h3 id="configure-permissions" className="text-lg font-semibold mt-6 mb-3">Configuring Permissions</h3>
        <p className="text-muted-foreground mb-4">
          In the app:
        </p>
        <ol className="text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Go to Settings → AI Backend → Permissions</li>
          <li>Choose your permission mode</li>
          <li>Optionally, enable/disable specific tools</li>
        </ol>

        <h3 id="per-tool-settings" className="text-lg font-semibold mt-6 mb-3">Per-Tool Settings</h3>
        <p className="text-muted-foreground mb-4">
          You can also configure individual tools:
        </p>
        <SimpleTable
          headers={["Tool", "Recommendation"]}
          rows={[
            ["Read, Glob, Grep", "Always auto-approve (read-only)"],
            ["Edit", "Auto-approve if you review via git, otherwise ask"],
            ["Write", "Auto-approve for new files, review for overwrites"],
            ["Bash", "Always ask (can run any command)"],
            ["Task", "Ask if you want control over sub-agents"],
          ]}
        />
      </section>

      {/* Security Best Practices */}
      <section className="mb-12">
        <h2 id="security" className="text-2xl font-semibold mb-4">Security Best Practices</h2>
        
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2 text-[#7fd88f]">Do:</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>✓ Review bash commands before approving</li>
              <li>✓ Check diffs to understand what&apos;s changing</li>
              <li>✓ Use git to track changes (easy to revert)</li>
              <li>✓ Start with default mode, loosen as you gain trust</li>
              <li>✓ Deny anything that looks suspicious</li>
            </ul>
          </div>

          <div className="border border-border rounded-lg p-4">
            <div className="font-medium mb-2 text-red-400">Don&apos;t:</div>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>✗ Use &quot;allowAll&quot; mode on production systems</li>
              <li>✗ Approve commands you don&apos;t understand</li>
              <li>✗ Ignore the details in approval cards</li>
              <li>✗ Give the AI access to sensitive directories</li>
              <li>✗ Approve broad delete operations without review</li>
            </ul>
          </div>
        </div>

        <Callout type="tip" title="Pro tip: Use git">
          Keep your project in a git repository. Even if you approve something by mistake, 
          you can always <code className="bg-muted/50 px-1 rounded">git checkout</code> or <code className="bg-muted/50 px-1 rounded">git reset</code> to undo changes.
        </Callout>
      </section>

      {/* What Happens When You Deny */}
      <section className="mb-12">
        <h2 id="when-you-deny" className="text-2xl font-semibold mb-4">What Happens When You Deny</h2>
        <p className="text-muted-foreground mb-4">
          When you deny a request:
        </p>
        <ol className="text-muted-foreground space-y-2 list-decimal list-inside">
          <li>The action is <strong className="text-foreground">not executed</strong></li>
          <li>The AI receives a &quot;permission denied&quot; response</li>
          <li>The AI typically acknowledges and may suggest an alternative</li>
          <li>You can explain why you denied (helps the AI understand)</li>
        </ol>

        <Callout type="info" title="Denying is safe">
          Denying never breaks anything. The AI is designed to handle denials gracefully. 
          If you&apos;re unsure, it&apos;s always safer to deny and ask for clarification.
        </Callout>
      </section>

      {/* Notifications */}
      <section className="mb-12">
        <h2 id="notifications" className="text-2xl font-semibold mb-4">Permission Notifications</h2>
        <p className="text-muted-foreground mb-4">
          When a permission request comes in while you&apos;re not looking at the app:
        </p>
        <ul className="text-muted-foreground space-y-2">
          <li>• <strong className="text-foreground">Push notification:</strong> Your phone notifies you (if enabled)</li>
          <li>• <strong className="text-foreground">Badge count:</strong> App icon shows pending requests</li>
          <li>• <strong className="text-foreground">Session status:</strong> Session shows &quot;Waiting for approval&quot;</li>
        </ul>
        <p className="text-muted-foreground mt-4">
          Enable notifications in Settings → Notifications to never miss a permission request.
        </p>
      </section>

      {/* Related */}
      <section className="mt-12 pt-8 border-t border-border">
        <h2 id="related" className="text-lg font-semibold mb-4">Related</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href="/docs/guides/first-session" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Your First Session</h3>
            <p className="text-sm text-muted-foreground">Complete walkthrough for beginners</p>
          </a>
          <a href="/docs/reference/privacy" className="block p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/30 transition-colors">
            <h3 className="font-medium mb-1">Privacy & Security</h3>
            <p className="text-sm text-muted-foreground">How Broski protects your data</p>
          </a>
        </div>
      </section>
    </article>
  );
}
