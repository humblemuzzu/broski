import type { Metadata } from "next";
import { SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "Sessions - Broski",
  description: "Managing chat sessions in the Broski mobile app",
};

export default function SessionsPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="sessions" className="text-3xl font-bold mb-3">Sessions</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Manage your AI coding conversations across projects.
      </p>

      <Callout type="info" title="What are Sessions?">
        Sessions are individual conversations with the AI. Each session tracks messages, 
        tool calls, file changes, and context. Sessions are organized by project and can 
        be highlighted, forked, or filtered.
      </Callout>

      <h2 id="sessions-list" className="text-xl font-semibold mb-4 mt-10">Sessions List</h2>
      <p className="text-muted-foreground mb-4">
        The Sessions screen shows all your conversations organized by project and time.
      </p>

      <h3 id="header" className="text-lg font-medium mb-3 mt-6">Header</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Sessions title</strong> - Large header text</li>
        <li><strong>Refresh button</strong> - Manually refresh the list</li>
        <li><strong>Connection dot</strong> - Green (connected) or red (disconnected)</li>
        <li><strong>Subtitle</strong> - "Continue your AI coding sessions"</li>
      </ul>

      <h3 id="filters" className="text-lg font-medium mb-3 mt-6">Filter Controls</h3>
      <p className="text-muted-foreground mb-4">
        Below the header, you'll find filter options:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Project filter</strong> - Chip showing "All projects" or selected project name</li>
        <li><strong>Background tasks toggle</strong> - Tree icon with count of subagent tasks</li>
        <li><strong>Title filters</strong> - Hide sessions matching text patterns or regex</li>
      </ul>

      <h2 id="session-cards" className="text-xl font-semibold mb-4 mt-10">Session Cards</h2>
      <p className="text-muted-foreground mb-4">
        Each session card displays:
      </p>

      <SimpleTable
        headers={["Element", "Description"]}
        rows={[
          ["Avatar", "First letter of session title"],
          ["Status Dot", "Bottom-left indicator (active/idle)"],
          ["Title", "Session name (auto-generated or custom)"],
          ["Project + Time", '"ProjectName - 2h ago"'],
          ["Forked Badge", 'Purple "Forked" pill if branched'],
          ["Child Count", "Tree icon with number if has background tasks"],
        ]}
      />

      <h2 id="session-states" className="text-xl font-semibold mb-4 mt-10">Session States</h2>
      <p className="text-muted-foreground mb-4">
        Sessions can be in different states indicated visually:
      </p>

      <SimpleTable
        headers={["Status", "Visual Indicator", "Description"]}
        rows={[
          ["Idle", "Gray dot, no badge", "Session is not actively running"],
          ["Active", 'Blue pulsing dot, "Active" badge', "AI is currently responding"],
          ["Retry", 'Yellow dot, "Retry" badge', "Session is retrying after error"],
          ["Highlighted", "Gold star, colored border", "Starred by user for quick access"],
        ]}
      />

      <h2 id="active-sessions" className="text-xl font-semibold mb-4 mt-10">Active Sessions</h2>
      <p className="text-muted-foreground mb-4">
        Running sessions appear at the top in a special section:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Pulsing indicator</strong> - Animated dot for active sessions</li>
        <li><strong>Active badge</strong> - Blue pill showing session is working</li>
        <li><strong>Retry badge</strong> - Yellow pill if retrying after error</li>
      </ul>

      <h2 id="highlighted-sessions" className="text-xl font-semibold mb-4 mt-10">Highlighted Sessions</h2>
      <p className="text-muted-foreground mb-4">
        Sessions you've starred appear in a separate "Highlighted" section:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Star icon</strong> - Gold star on the card</li>
        <li><strong>Accent border</strong> - Colored left border</li>
        <li><strong>Priority placement</strong> - Always visible above regular sessions</li>
      </ul>

      <Callout type="tip" title="To highlight a session">
        Long-press on any session card and select "Highlight" from the menu.
      </Callout>

      <h2 id="session-actions" className="text-xl font-semibold mb-4 mt-10">Session Actions</h2>

      <SimpleTable
        headers={["Action", "How to Trigger", "Result"]}
        rows={[
          ["Open", "Tap the card", "Opens session in Chat screen"],
          ["Highlight", "Long press > Highlight", "Toggle starred status"],
          ["Rename", "Long press > Rename", "Change session title"],
          ["Delete", "Swipe left", "Delete with confirmation dialog"],
        ]}
      />

      <h2 id="background-tasks" className="text-xl font-semibold mb-4 mt-10">Background Tasks</h2>
      <p className="text-muted-foreground mb-4">
        When "Background Tasks" toggle is enabled, sessions with subagent work show expandable children:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li>Sessions with children show an expand arrow</li>
        <li>Tap the child count badge to expand</li>
        <li>Nested cards appear indented below the parent</li>
        <li>Each child shows: Agent badge (e.g., "@explore"), task description, status</li>
      </ul>

      <h2 id="forking" className="text-xl font-semibold mb-4 mt-10">Forking Sessions</h2>
      <p className="text-muted-foreground mb-4">
        Fork a session to create a branch from any point in the conversation:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li>Use the menu option in Chat screen</li>
        <li>Or long-press a message and select "Fork from here"</li>
        <li>Forked sessions show a purple "Forked" badge</li>
        <li>Great for trying alternative approaches without losing context</li>
      </ul>

      <h2 id="empty-state" className="text-xl font-semibold mb-4 mt-10">Empty State</h2>
      <p className="text-muted-foreground mb-4">
        When no sessions exist, you'll see:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Chat icon</strong> - Indicates no sessions</li>
        <li><strong>Message</strong> - Prompt to create a new session from Projects</li>
      </ul>

      <h2 id="next" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/app/chat" title="Chat Interface" description="Messages, tools, and input" />
        <Card href="/docs/app" title="App Overview" description="Navigation and gestures" />
      </CardGrid>
    </article>
  );
}
