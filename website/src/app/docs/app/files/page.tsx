import type { Metadata } from "next";
import { SimpleTable, Callout, CardGrid, Card } from "@/components/docs";

export const metadata: Metadata = {
  title: "File Browser - Broski",
  description: "Navigating and searching your codebase in the Broski mobile app",
};

export default function FilesPage() {
  return (
    <article className="max-w-2xl">
      <h1 id="files" className="text-3xl font-bold mb-3">File Browser</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Navigate and search your codebase from the Browse tab.
      </p>

      <Callout type="info" title="Project-Aware Browsing">
        The file browser automatically syncs with your selected project. When you select 
        a project in Sessions or Projects, Browse shows that directory.
      </Callout>

      <h2 id="navigation" className="text-xl font-semibold mb-4 mt-10">Navigation</h2>

      <h3 id="path-display" className="text-lg font-medium mb-3 mt-6">Path Display</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Tap title</strong> - Show full breadcrumb path</li>
        <li><strong>Breadcrumb chips</strong> - Tap any segment to navigate there</li>
        <li><strong>".." entry</strong> - Go up one directory</li>
      </ul>

      <h3 id="app-bar" className="text-lg font-medium mb-3 mt-6">App Bar</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Back arrow</strong> - Go up directory or close browser</li>
        <li><strong>Path title</strong> - Current location (tap for breadcrumb)</li>
        <li><strong>Search button</strong> - Open search mode</li>
        <li><strong>Project button</strong> - Jump to current project root</li>
        <li><strong>Connection indicator</strong> - Small status dot</li>
      </ul>

      <h2 id="file-list" className="text-xl font-semibold mb-4 mt-10">File List</h2>
      <p className="text-muted-foreground mb-4">
        Each item in the file list shows:
      </p>

      <SimpleTable
        headers={["Element", "Description"]}
        rows={[
          ["Icon", "Folder or file type icon"],
          ["Name", "File/folder name"],
          ["Subtitle", '"Folder" or file size'],
          ["Git Status", "M/A/D/R/? badges for changes"],
          ["Chevron", "Navigate arrow"],
        ]}
      />

      <h2 id="file-icons" className="text-xl font-semibold mb-4 mt-10">File Icons</h2>
      <p className="text-muted-foreground mb-4">
        File icons are assigned by extension:
      </p>

      <SimpleTable
        headers={["Extension", "Icon"]}
        rows={[
          [".dart", "Code (blue)"],
          [".ts, .tsx, .js, .jsx", "JavaScript (yellow)"],
          [".json", "Data object"],
          [".yaml, .yml", "Settings"],
          [".md", "Document"],
          [".png, .jpg, .jpeg, .gif, .svg", "Image"],
          [".pdf", "PDF"],
          ["Other", "Generic file"],
        ]}
      />

      <h2 id="git-status" className="text-xl font-semibold mb-4 mt-10">Git Status Badges</h2>
      <p className="text-muted-foreground mb-4">
        Files with git changes show colored badges:
      </p>

      <SimpleTable
        headers={["Badge", "Color", "Meaning"]}
        rows={[
          ["M", "Primary", "Modified"],
          ["A", "Green", "Added"],
          ["D", "Red", "Deleted"],
          ["R", "Orange", "Renamed"],
          ["C", "Blue", "Copied"],
          ["?", "Gray", "Untracked"],
          ["!", "Gray", "Ignored"],
        ]}
      />

      <Callout type="tip" title="Git Status">
        Git status is only shown when browsing within a project directory. The status 
        is fetched from your system and updates when you refresh.
      </Callout>

      <h2 id="search" className="text-xl font-semibold mb-4 mt-10">Search</h2>
      <p className="text-muted-foreground mb-4">
        Tap the search icon to enter search mode. Three search types are available:
      </p>

      <h3 id="file-search" className="text-lg font-medium mb-3 mt-6">File Search</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li>Search files by name</li>
        <li>Results show full path</li>
        <li>Tap to open file</li>
      </ul>

      <h3 id="text-search" className="text-lg font-medium mb-3 mt-6">Text Search</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li>Search content within files</li>
        <li>Results show filename + line number</li>
        <li>Preview of matching line</li>
        <li>Tap to open at that location</li>
      </ul>

      <h3 id="symbol-search" className="text-lg font-medium mb-3 mt-6">Symbol Search</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li>Search functions, classes, variables</li>
        <li>Results show symbol name + type</li>
        <li>Icon indicates symbol kind (class, function, variable, etc.)</li>
        <li>Tap to open file at definition</li>
      </ul>

      <p className="text-sm text-muted-foreground mt-4">
        Use the dropdown menu (icon in search bar) to switch between search types.
      </p>

      <h2 id="file-viewer" className="text-xl font-semibold mb-4 mt-10">Viewing Files</h2>
      <p className="text-muted-foreground mb-4">
        Tap any file to open the viewer:
      </p>

      <h3 id="code-files" className="text-lg font-medium mb-3 mt-6">Code Files</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Syntax highlighting</strong> - Language-specific colors</li>
        <li><strong>Line numbers</strong> - Along left edge</li>
        <li><strong>Copy button</strong> - Copy entire file to clipboard</li>
        <li><strong>Language indicator</strong> - Shows detected language in subtitle</li>
      </ul>

      <h3 id="images" className="text-lg font-medium mb-3 mt-6">Images</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Inline preview</strong> - Display directly in viewer</li>
        <li><strong>Pinch to zoom</strong> - Standard gesture</li>
        <li><strong>Pan</strong> - Drag to move around</li>
      </ul>

      <h3 id="binary-files" className="text-lg font-medium mb-3 mt-6">Binary Files</h3>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Type indicator</strong> - Shows file type</li>
        <li><strong>Size warning</strong> - For large files</li>
        <li><strong>"Cannot Preview"</strong> - Unsupported types</li>
      </ul>

      <Callout type="warning" title="Large Files">
        Files over a certain size limit cannot be previewed to prevent memory issues. 
        You'll see a "File too large" message with the file size.
      </Callout>

      <h2 id="empty-state" className="text-xl font-semibold mb-4 mt-10">Empty Folder</h2>
      <p className="text-muted-foreground mb-4">
        When a folder is empty, you'll see:
      </p>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li>Folder icon</li>
        <li>"Empty folder" message</li>
        <li>Pull down to refresh</li>
      </ul>

      <h2 id="navigation-tips" className="text-xl font-semibold mb-4 mt-10">Navigation Tips</h2>
      <ul className="list-disc list-inside text-muted-foreground space-y-1 mb-6">
        <li><strong>Swipe back</strong> - iOS gesture to go up a directory</li>
        <li><strong>Project button</strong> - Quick jump to project root</li>
        <li><strong>Breadcrumb navigation</strong> - Tap path to see full breadcrumb</li>
        <li><strong>Pull to refresh</strong> - Update file list</li>
      </ul>

      <h2 id="next" className="text-lg font-semibold mb-4 mt-10">Next</h2>
      <CardGrid>
        <Card href="/docs/app/settings" title="Settings" description="App configuration" />
        <Card href="/docs/app/chat" title="Chat Interface" description="Messages and tools" />
      </CardGrid>
    </article>
  );
}
