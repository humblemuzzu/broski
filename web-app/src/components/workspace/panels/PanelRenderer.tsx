import { DashboardPanel } from "@/components/workspace/panels/DashboardPanel"
import { ChatPanel } from "@/components/workspace/panels/ChatPanel"
import { PlaceholderPanel } from "@/components/workspace/panels/PlaceholderPanel"
import { TerminalPanel } from "@/components/workspace/panels/TerminalPanel"
import { FilesPanel } from "@/components/workspace/panels/FilesPanel"
import { GitPanel } from "@/components/workspace/panels/GitPanel"
import { BrowserPanel } from "@/components/workspace/panels/BrowserPanel"
import { SpecPanel } from "@/components/workspace/panels/SpecPanel"
import { NewPanelChooserPanel } from "@/components/workspace/panels/NewPanelChooserPanel"
import type { MosaicBranch } from "react-mosaic-component"

function stripInstanceSuffix(panelId: string): string {
  const idx = panelId.indexOf("#")
  return idx === -1 ? panelId : panelId.slice(0, idx)
}

export function PanelRenderer({
  panelId,
  path,
}: {
  panelId: string
  path: Array<MosaicBranch>
}) {
  const baseId = stripInstanceSuffix(panelId)
  if (baseId === "dashboard") return <DashboardPanel />
  if (baseId.startsWith("new:")) {
    return <NewPanelChooserPanel panelId={panelId} path={path} />
  }
  if (baseId.startsWith("chat:")) {
    const rest = baseId.slice("chat:".length)
    const [agent, ...tail] = rest.split(":")
    const sessionId = tail.join(":")
    return <ChatPanel agent={agent} sessionId={sessionId} />
  }
  if (baseId.startsWith("terminal:")) {
    const projectPath = baseId.slice("terminal:".length)
    return <TerminalPanel projectPath={projectPath} />
  }
  if (baseId.startsWith("files:")) {
    const projectPath = baseId.slice("files:".length)
    return <FilesPanel projectPath={projectPath} />
  }
  if (baseId.startsWith("git:")) {
    const projectPath = baseId.slice("git:".length)
    return <GitPanel projectPath={projectPath} />
  }
  if (baseId.startsWith("browser:")) {
    const projectPath = baseId.slice("browser:".length)
    return <BrowserPanel projectPath={projectPath} />
  }
  if (baseId.startsWith("spec:")) {
    const projectPath = baseId.slice("spec:".length)
    return <SpecPanel projectPath={projectPath} />
  }
  return <PlaceholderPanel title={baseId} />
}
