import * as React from "react"
import { DatabaseZap, RefreshCw } from "lucide-react"

import { useConnectionStore } from "@/stores/connection-store"
import { useProjectsStore } from "@/stores/projects-store"
import { useIntegrationsStore } from "@/stores/integrations-store"
import { useMcpStore } from "@/stores/mcp-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useFilesStore } from "@/stores/files-store"
import { Button } from "@/components/ui/button"
import { IntegrationsTabNav } from "./IntegrationsTabNav"
import { McpTab } from "./McpTab"
import { ToolsTab } from "./ToolsTab"
import { ProvidersTab } from "./ProvidersTab"

type Tab = "mcp" | "tools" | "providers"

function tryOpenResource(uri: string, cwd: string, openPanel: any, selectFile: any, send: any) {
  const trimmed = (uri ?? "").trim()
  if (!trimmed) return
  const asPath = (() => {
    if (trimmed.startsWith("file://")) {
      try {
        const u = new URL(trimmed)
        return decodeURIComponent(u.pathname)
      } catch {
        return null
      }
    }
    if (trimmed.startsWith("/")) return trimmed
    return null
  })()
  if (!asPath) return
  openPanel(`files:${cwd}`)
  selectFile(asPath)
  send({ type: "read_file", path: asPath } as any)
}

export function IntegrationsPanel({ projectPath }: { projectPath: string }) {
  const send = useConnectionStore((s) => s.send)
  const selectedProjectPath = useProjectsStore((s) => s.selectedProjectPath)
  const cwd = projectPath || selectedProjectPath || ""
  const openPanel = useWorkspaceStore((s) => s.openPanel)
  const selectFile = useFilesStore((s) => s.selectFile)

  const [tab, setTab] = React.useState<Tab>("mcp")
  const [mcpName, setMcpName] = React.useState("")
  const [toolsProvider, setToolsProvider] = React.useState("")
  const [toolsModel, setToolsModel] = React.useState("")

  const ocMcpStatus = useIntegrationsStore((s) => s.ocMcpStatus)
  const ocMcpResources = useIntegrationsStore((s) => s.ocMcpResources)
  const ocToolIds = useIntegrationsStore((s) => s.ocToolIds)
  const ocTools = useIntegrationsStore((s) => s.ocTools)
  const ocAllProviders = useIntegrationsStore((s) => s.ocAllProviders)
  const ocProviderAuth = useIntegrationsStore((s) => s.ocProviderAuth)

  const codexMcpStatus = useMcpStore((s) => s.codexMcpStatus)

  const refresh = React.useCallback(() => {
    if (!cwd) return
    if (tab === "mcp") {
      send({ type: "get_mcp_status", projectPath: cwd } as any)
      send({ type: "get_mcp_resources", projectPath: cwd } as any)
      // Codex MCP is global
      send({ type: "cx_mcp_status_list" } as any)
      return
    }
    if (tab === "tools") {
      send({ type: "list_tool_ids", projectPath: cwd } as any)
      if (toolsProvider && toolsModel) {
        send({ type: "list_tools", provider: toolsProvider, model: toolsModel, projectPath: cwd } as any)
      }
      return
    }
    if (tab === "providers") {
      send({ type: "list_all_providers", projectPath: cwd } as any)
      send({ type: "get_provider_auth", projectPath: cwd } as any)
    }
  }, [cwd, send, tab, toolsModel, toolsProvider])

  React.useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, cwd])

  const ocServers = React.useMemo(() => {
    const map = ocMcpStatus ?? {}
    return Object.keys(map)
      .sort()
      .map((k) => map[k]!)
  }, [ocMcpStatus])

  const ocResources = React.useMemo(() => {
    const map = ocMcpResources ?? {}
    return Object.keys(map)
      .sort()
      .map((k) => map[k]!)
  }, [ocMcpResources])

  const providerOptions = React.useMemo(() => {
    const all = ocAllProviders?.all ?? []
    return all.map((p) => ({ id: p.id, name: p.name, models: Object.keys(p.models ?? {}) }))
  }, [ocAllProviders?.all])

  const handleConnect = () => {
    const name = mcpName.trim()
    if (!name || !cwd) return
    send({ type: "connect_mcp", name, projectPath: cwd } as any)
  }

  const handleDisconnect = () => {
    const name = mcpName.trim()
    if (!name || !cwd) return
    send({ type: "disconnect_mcp", name, projectPath: cwd } as any)
  }

  const handleListTools = () => {
    if (!cwd) return
    if (!toolsProvider || !toolsModel) return
    send({ type: "list_tools", provider: toolsProvider, model: toolsModel, projectPath: cwd } as any)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="flex items-center gap-2">
          <DatabaseZap className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Integrations</div>
            <div className="mt-1 text-xs text-muted-foreground">{cwd}</div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={!cwd}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="border-b border-[var(--panel-border)] bg-[var(--panel-header)] p-3">
        <IntegrationsTabNav value={tab} onChange={setTab} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "mcp" && (
          <McpTab
            mcpName={mcpName}
            onMcpNameChange={setMcpName}
            servers={ocServers}
            resources={ocResources}
            codexMcpStatus={codexMcpStatus}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onOpenResource={(uri) => tryOpenResource(uri, cwd, openPanel, selectFile, send)}
            disabled={!cwd}
          />
        )}

        {tab === "tools" && (
          <ToolsTab
            toolsProvider={toolsProvider}
            toolsModel={toolsModel}
            onToolsProviderChange={setToolsProvider}
            onToolsModelChange={setToolsModel}
            toolIds={ocToolIds}
            tools={ocTools}
            providerOptions={providerOptions}
            onListIds={() => send({ type: "list_tool_ids", projectPath: cwd } as any)}
            onListTools={handleListTools}
            disabled={!cwd}
          />
        )}

        {tab === "providers" && (
          <ProvidersTab
            allProviders={ocAllProviders}
            providerAuth={ocProviderAuth}
            onListProviders={() => send({ type: "list_all_providers", projectPath: cwd } as any)}
            onGetAuth={() => send({ type: "get_provider_auth", projectPath: cwd } as any)}
            disabled={!cwd}
          />
        )}
      </div>
    </div>
  )
}