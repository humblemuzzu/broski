import * as React from "react"

import { Sidebar } from "@/components/sidebar"
import { MainContent } from "@/components/main"

/**
 * Layout - Main app layout with collapsible Sidebar + MainContent
 * 
 * Keyboard shortcuts:
 * - Cmd+B (Mac) / Ctrl+B (Windows): Toggle sidebar
 */
export function Layout() {
  const [sidebarOpen, setSidebarOpen] = React.useState(false) // Closed by default

  // Keyboard shortcut: Cmd+B / Ctrl+B to toggle sidebar
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault()
        setSidebarOpen((prev) => !prev)
      }
    }
    
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#0f0f0f",
        overflow: "hidden",
      }}
    >
      {/* Sidebar - collapsible */}
      {sidebarOpen && <Sidebar onClose={() => setSidebarOpen(false)} />}

      {/* Main content - takes full space */}
      <MainContent 
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} 
      />
    </div>
  )
}
