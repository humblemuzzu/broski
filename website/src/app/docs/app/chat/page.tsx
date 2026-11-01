import type { Metadata } from "next";
import { SimpleTable, Callout, CardGrid, Card, CodeBlock } from "@/components/docs";

export const metadata: Metadata = {
  title: "Chat Interface - Broski",
  description: "The chat screen in the Broski mobile app",
};

export default function ChatPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="chat" className="text-3xl font-bold mb-3">Chat Interface</h1>
      <p className="text-lg text-muted-foreground mb-8">
        The heart of Broski - where you interact with your AI coding assistant.
      </p>

      <Callout type="info" title="Real-time Interaction">
        The chat screen streams AI responses in real-time, shows tool execution progress, 
        displays file diffs, and handles permission requests - all from your phone.
      </Callout>

      <h2 id="app-bar" className="text-xl font-semibold mb-4 mt-10">App Bar</h2>
      <p className="text-muted-foreground mb-4">
        The top bar contains:
      </p>

      <SimpleTable
        headers={["Element", "Description"]}
        rows={[
          ["Back Arrow", "Return to previous screen"],
          ["Session Title", "Current session name"],
          ["Project Subtitle", "Project folder name"],
          ["Sidebar Button", "Open session context panel"],
          ["More Menu", "Additional session actions"],
        ]}
      />

      <h3 id="more-menu" className="text-lg font-medium mb-3 mt-6">More Menu Options</h3>
      <p className="text-muted-foreground mb-4">
        Tap the three-dot menu for session actions:
      </p>

      <SimpleTable
        headers={["Option", "Description"]}
        rows={[
          ["Fork Session", "Create a branch from current point"],
          ["Compact", "Summarize old messages to save context"],
          ["Initialize", "Create AGENTS.md for the project"],
        ]}
      />

      <h3 id="claude-code-menu" className="text-lg font-medium mb-3 mt-6">Claude Code Menu</h3>
      <p className="text-muted-foreground mb-4">
        When using Claude Code, additional options appear:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Model</strong> - Switch between Sonnet, Opus, Haiku</li>
        <li><strong>Tools</strong> - Configure permissions and enabled tools</li>
        <li><strong>Commands</strong> - View available slash commands</li>
        <li><strong>Skills</strong> - Browse loaded skills</li>
        <li><strong>Hooks</strong> - View active hooks</li>
        <li><strong>MCP Servers</strong> - Check MCP server status</li>
      </ul>

      <h2 id="session-sidebar" className="text-xl font-semibold mb-4 mt-10">Session Sidebar</h2>
      <p className="text-muted-foreground mb-4">
        Tap the sidebar button to reveal session context:
      </p>

      <SimpleTable
        headers={["Section", "Information"]}
        rows={[
          ["Token Usage", "Input/output/cache read tokens"],
          ["Cost", "Estimated API cost in USD"],
          ["Modified Files", "List of changed files with +/- counts"],
          ["Todos", "Task list"],
        ]}
      />

      <h2 id="message-types" className="text-xl font-semibold mb-4 mt-10">Message Types</h2>

      <h3 id="user-messages" className="text-lg font-medium mb-3 mt-6">User Messages</h3>
      <p className="text-muted-foreground mb-4">
        Your messages appear on the right side:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Primary color background</strong> - Subtle accent color</li>
        <li><strong>Rounded corners</strong> - Bubble shape with sharp bottom-right</li>
        <li><strong>Text content</strong> - Your input preserved as-is</li>
      </ul>

      <h3 id="assistant-messages" className="text-lg font-medium mb-3 mt-6">Assistant Messages</h3>
      <p className="text-muted-foreground mb-4">
        AI responses appear on the left:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Left accent bar</strong> - Subtle vertical line</li>
        <li><strong>Markdown support</strong> - Headers, bold, italic, code, links</li>
        <li><strong>Streaming indicator</strong> - Pulsing blue dot while generating</li>
      </ul>

      <h3 id="system-messages" className="text-lg font-medium mb-3 mt-6">System Messages</h3>
      <p className="text-muted-foreground mb-4">
        Status and error information:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Error messages</strong> - Red background with error icon</li>
        <li><strong>Diff-only messages</strong> - Hidden (diffs shown inline)</li>
      </ul>

      <h2 id="markdown" className="text-xl font-semibold mb-4 mt-10">Markdown Rendering</h2>
      <p className="text-muted-foreground mb-4">
        AI responses support GitHub-flavored markdown:
      </p>

      <SimpleTable
        headers={["Syntax", "Rendering"]}
        rows={[
          ["**bold**", "Bold text"],
          ["*italic*", "Italic text"],
          ["`code`", "Inline code with background"],
          ["```code blocks```", "Syntax highlighted with line numbers"],
          ["# Heading", "Styled headers (H1-H3)"],
          ["[link](url)", "Clickable blue links"],
          ["- item", "Bulleted lists with indentation"],
          ["> quote", "Block quotes with left border"],
        ]}
      />

      <h2 id="code-blocks" className="text-xl font-semibold mb-4 mt-10">Code Blocks</h2>
      <p className="text-muted-foreground mb-4">
        Code blocks in messages feature:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Syntax highlighting</strong> - Language-specific colors</li>
        <li><strong>Dark theme</strong> - Atom One Dark style</li>
        <li><strong>Monospace font</strong> - JetBrains Mono</li>
        <li><strong>Copy support</strong> - Select and copy code text</li>
      </ul>

      <h2 id="tool-calls" className="text-xl font-semibold mb-4 mt-10">Tool Calls</h2>
      <p className="text-muted-foreground mb-4">
        When the AI uses tools, you'll see Tool Call Cards:
      </p>

      <SimpleTable
        headers={["Element", "Description"]}
        rows={[
          ["Tool Icon", "Type-specific icon (edit, read, bash, etc.)"],
          ['Tool Name', 'e.g., "Editing file.dart"'],
          ["Status Indicator", "Running (spinner) or Completed (checkmark)"],
          ["Expand Arrow", "Tap to see details"],
        ]}
      />

      <h3 id="tool-icons" className="text-lg font-medium mb-3 mt-6">Tool Types and Icons</h3>

      <SimpleTable
        headers={["Tool", "Icon", "Description"]}
        rows={[
          ["Read", "Document", "Reading file contents"],
          ["Edit", "Pencil", "Modifying existing file"],
          ["Write", "Plus-document", "Creating new file"],
          ["Bash", "Terminal", "Running shell command"],
          ["Search", "Magnifying glass", "Searching files/text"],
          ["Task", "Robot", "Delegating to subagent"],
          ["Thinking", "Brain", "Model reasoning"],
        ]}
      />

      <h3 id="expanded-tool" className="text-lg font-medium mb-3 mt-6">Expanded Tool Card</h3>
      <p className="text-muted-foreground mb-4">
        When expanded, tool cards show:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Input parameters</strong> - File paths, content, commands</li>
        <li><strong>Output</strong> - Tool execution results</li>
        <li><strong>Code preview</strong> - Syntax-highlighted content</li>
        <li><strong>Undo button</strong> - Revert changes (edit tools only)</li>
        <li><strong>Copy button</strong> - Copy content to clipboard</li>
      </ul>

      <h2 id="file-diffs" className="text-xl font-semibold mb-4 mt-10">File Diffs</h2>
      <p className="text-muted-foreground mb-4">
        When the AI modifies files, inline diff viewers appear:
      </p>

      <h3 id="diff-card" className="text-lg font-medium mb-3 mt-6">Diff Card Elements</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>File icon</strong> - Code file indicator</li>
        <li><strong>File name</strong> - Just the filename (not full path)</li>
        <li><strong>Change stats</strong> - Green +X and red -Y counts</li>
        <li><strong>Expand arrow</strong> - Show more diff lines</li>
      </ul>

      <h3 id="diff-preview" className="text-lg font-medium mb-3 mt-6">Inline Diff Preview</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Red lines</strong> - Removed content with - prefix</li>
        <li><strong>Green lines</strong> - Added content with + prefix</li>
        <li><strong>Line numbers</strong> - Position reference</li>
        <li><strong>Stats badges</strong> - +5 -3 showing net changes</li>
      </ul>

      <h3 id="diff-actions" className="text-lg font-medium mb-3 mt-6">Diff Actions</h3>

      <SimpleTable
        headers={["Action", "Result"]}
        rows={[
          ["Tap", "Expand/collapse diff preview"],
          ['"View full" button', "Open full-screen diff viewer"],
          ['"Undo" button', "Revert this specific change"],
        ]}
      />

      <h3 id="full-screen-diff" className="text-lg font-medium mb-3 mt-6">Full-Screen Diff View</h3>
      <p className="text-muted-foreground mb-4">
        Tap "View full" to open the full-screen viewer:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Split view</strong> - Before (left) and After (right)</li>
        <li><strong>Unified view</strong> - Single column with +/- prefixes</li>
        <li><strong>Line numbers</strong> - Both old and new line numbers</li>
        <li><strong>Color coding</strong> - Red/green backgrounds</li>
        <li><strong>Scroll sync</strong> - Both panes scroll together</li>
      </ul>

      <h2 id="permissions" className="text-xl font-semibold mb-4 mt-10">Permission Requests</h2>
      <p className="text-muted-foreground mb-4">
        When the AI needs to perform potentially dangerous actions, you'll see a permission prompt:
      </p>

      <SimpleTable
        headers={["Element", "Description"]}
        rows={[
          ["Title", '"Permission required"'],
          ["Description", "What the AI wants to do"],
          ["Command", "Specific command (if bash)"],
          ["Diff Preview", "Proposed changes (if file edit)"],
          ["Deny Button", "Red outline, rejects the action"],
          ["Approve Button", "Primary color, allows the action"],
        ]}
      />

      <Callout type="warning" title="Common Permission Scenarios">
        File edits show the proposed diff before applying. Shell commands show the exact command.
        Destructive operations require extra confirmation.
      </Callout>

      <h2 id="thinking" className="text-xl font-semibold mb-4 mt-10">Thinking Card</h2>
      <p className="text-muted-foreground mb-4">
        When the AI is reasoning (extended thinking), you'll see a Thinking Card:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Brain icon</strong> - Indicates reasoning mode</li>
        <li><strong>Elapsed time</strong> - "Thinking... 2.3s"</li>
        <li><strong>Expandable content</strong> - See reasoning text</li>
        <li><strong>Streaming animation</strong> - Pulsing while active</li>
      </ul>

      <h2 id="input-bar" className="text-xl font-semibold mb-4 mt-10">Input Bar</h2>
      <p className="text-muted-foreground mb-4">
        The input bar at the bottom is where you type messages:
      </p>

      <SimpleTable
        headers={["Element", "Description"]}
        rows={[
          ["Text Field", "Multi-line text input"],
          ["Attachment Button", "Add files or images"],
          ["Send Button", "Submit your message"],
        ]}
      />

      <h3 id="input-styles" className="text-lg font-medium mb-3 mt-6">Input Styles</h3>
      <p className="text-muted-foreground mb-4">
        The input bar supports different styles (Settings &gt; Customization):
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Standard</strong> - Simple text field</li>
        <li><strong>Rounded</strong> - Pill-shaped input</li>
        <li><strong>Outlined</strong> - Border emphasis style</li>
      </ul>

      <h3 id="attachments" className="text-lg font-medium mb-3 mt-6">Attachments</h3>
      <p className="text-muted-foreground mb-4">
        Tap the attachment button for:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Take Photo</strong> - Use device camera</li>
        <li><strong>Choose from Gallery</strong> - Select existing image</li>
        <li><strong>Attach File</strong> - Type @ to search files</li>
      </ul>

      <h3 id="file-mentions" className="text-lg font-medium mb-3 mt-6">@ File Mentions</h3>
      <p className="text-muted-foreground mb-4">
        Type <code>@</code> in the input to search and attach files:
      </p>
      <ol className="list-decimal list-inside text-muted-foreground space-y-1 mb-6">
        <li>Type @ followed by search query</li>
        <li>Autocomplete dropdown appears</li>
        <li>Shows matching files from project</li>
        <li>Tap to attach file to message</li>
        <li>File content is sent to the AI</li>
      </ol>
      <p className="text-sm text-muted-foreground mb-6">
        For Claude Code, @ inserts the file path as text instead of attachment.
      </p>

      <h2 id="slash-commands" className="text-xl font-semibold mb-4 mt-10">Slash Commands</h2>
      <p className="text-muted-foreground mb-4">
        Type <code>/</code> to see available commands:
      </p>

      <SimpleTable
        headers={["Command", "Description"]}
        rows={[
          ["/undo", "Undo last message"],
          ["/redo", "Redo last message"],
          ["/compact", "Summarize session"],
          ["/fork", "Fork session"],
          ["/share", "Share session"],
          ["/new", "Create new session"],
          ["/help", "Show all commands"],
        ]}
      />

      <p className="text-sm text-muted-foreground mt-4">
        Custom commands from <code>.claude/commands/</code> also appear here.
      </p>

      <h2 id="agent-mentions" className="text-xl font-semibold mb-4 mt-10">Agent @ Mentions</h2>
      <p className="text-muted-foreground mb-4">
        Type <code>@</code> followed by an agent name to direct your request:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><code>@explore</code> - Code exploration agent</li>
        <li><code>@librarian</code> - Documentation agent</li>
        <li><code>@security</code> - Security analysis agent</li>
      </ul>

      <h2 id="auto-scroll" className="text-xl font-semibold mb-4 mt-10">Auto-Scroll Behavior</h2>
      <p className="text-muted-foreground mb-4">
        The chat automatically scrolls as new content arrives:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>During streaming</strong> - Follows new text</li>
        <li><strong>During tool execution</strong> - Shows tool progress</li>
        <li><strong>After scrolling up</strong> - Stops auto-scroll (respects your position)</li>
        <li><strong>Return to bottom</strong> - Auto-scroll resumes when you scroll back down</li>
      </ul>

      <h2 id="message-actions" className="text-xl font-semibold mb-4 mt-10">Message Actions</h2>
      <p className="text-muted-foreground mb-4">
        Long-press on a message for options:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Fork from here</strong> - Create new session branch starting at this message</li>
        <li><strong>Copy</strong> - Copy message text to clipboard</li>
      </ul>

      <h2 id="next" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/app/files" title="File Browser" description="Navigate your codebase" />
        <Card href="/docs/app/sessions" title="Sessions" description="Managing conversations" />
      </CardGrid>
    </article>
  );
}
