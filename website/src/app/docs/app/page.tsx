import type { Metadata } from "next";
import { CardGrid, Card, SimpleTable, Callout } from "@/components/docs";

export const metadata: Metadata = {
  title: "Mobile App - Broski",
  description: "Using the Broski mobile app for iOS and Android",
};

export default function AppOverviewPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="mobile-app" className="text-3xl font-bold mb-3">Mobile App</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Your AI coding assistant, in your pocket.
      </p>

      <Callout type="info" title="What you can do from your phone">
        Chat with AI coding assistants, review and approve code changes, browse your codebase, 
        manage sessions across projects, and monitor tool execution in real-time.
      </Callout>

      <h2 id="navigation" className="text-xl font-semibold mb-4 mt-10">Navigation</h2>
      <p className="text-muted-foreground mb-4">
        The app uses a bottom navigation bar with four main tabs:
      </p>

      <SimpleTable
        headers={["Tab", "Icon", "Description"]}
        rows={[
          ["Projects", "Grid icon", "Browse repositories and start new sessions"],
          ["Browse", "Folder icon", "File browser for your codebase"],
          ["Sessions", "History icon", "List of all chat sessions"],
          ["Settings", "Tune icon", "App configuration and preferences"],
        ]}
      />

      <h3 id="navigation-styles" className="text-lg font-medium mb-3 mt-6">Navigation Styles</h3>
      <p className="text-muted-foreground mb-4">
        Broski offers two navigation bar styles (Settings &gt; Customization):
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Classic</strong> - Standard bottom navigation with icons and labels</li>
        <li><strong>Glassmorphic</strong> - Floating pill-style navigation with blur effect</li>
      </ul>

      <h2 id="gestures" className="text-xl font-semibold mb-4 mt-10">Gestures</h2>
      <p className="text-muted-foreground mb-4">
        Common touch gestures throughout the app:
      </p>

      <SimpleTable
        headers={["Gesture", "Action"]}
        rows={[
          ["Tap", "Select, open, activate"],
          ["Long Press", "Show context menu or additional options"],
          ["Swipe Left", "Delete item (sessions, messages)"],
          ["Pull Down", "Refresh current list"],
          ["Pinch", "Zoom in file viewer (images)"],
        ]}
      />

      <h2 id="connection-status" className="text-xl font-semibold mb-4 mt-10">Connection Status</h2>
      <p className="text-muted-foreground mb-4">
        The connection quality indicator shows your current bridge status:
      </p>

      <SimpleTable
        headers={["Status", "Description"]}
        rows={[
          ["4 bars (green)", "Excellent connection (<30ms latency)"],
          ["3 bars (green)", "Good connection (50-100ms)"],
          ["2 bars (yellow)", "Fair connection (100-200ms)"],
          ["1 bar (red)", "Poor connection (>200ms)"],
          ["Offline icon", "Using cached data, cloud-off indicator"],
        ]}
      />

      <h3 id="offline-mode" className="text-lg font-medium mb-3 mt-6">Offline Mode</h3>
      <p className="text-muted-foreground mb-4">
        When connection is lost, Broski continues working with cached data:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Offline banner</strong> - Appears at top of screen</li>
        <li><strong>Cached sessions</strong> - Previous sessions and messages are available</li>
        <li><strong>Read-only</strong> - Cannot send new messages until reconnected</li>
        <li><strong>Tap to retry</strong> - Attempt reconnection manually</li>
      </ul>

      <h2 id="backgrounds" className="text-xl font-semibold mb-4 mt-10">Custom Backgrounds</h2>
      <p className="text-muted-foreground mb-4">
        Broski supports custom backgrounds that persist across screens:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Custom Image</strong> - Set a personal wallpaper from your gallery</li>
        <li><strong>Background Shade</strong> - Choose from theme-based shades (Deep, Base, Raised, etc.)</li>
        <li><strong>Per-Screen Control</strong> - Enable/disable background for specific screens</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Configure in Settings &gt; Customization &gt; Tool Cards &gt; Background.
      </p>

      <h2 id="app-sections" className="text-xl font-semibold mb-4 mt-10">App Sections</h2>
      
      <CardGrid>
        <Card
          href="/docs/app/sessions"
          title="Sessions"
          description="Managing chat sessions and background tasks"
        />
        <Card
          href="/docs/app/chat"
          title="Chat Interface"
          description="Messages, tool calls, diffs, and input"
        />
        <Card
          href="/docs/app/files"
          title="File Browser"
          description="Navigate and search your codebase"
        />
        <Card
          href="/docs/app/settings"
          title="Settings"
          description="Configuration and preferences"
        />
      </CardGrid>
    </article>
  );
}
