import { create } from "zustand"

import type {
  McpResource,
  McpServerStatus,
  ProviderAuthMethod,
  ProviderInfo,
  ToolInfo,
} from "@/core/types"

type IntegrationsState = {
  // OpenCode MCP
  ocMcpStatus: Record<string, McpServerStatus> | null
  ocMcpResources: Record<string, McpResource> | null

  // OpenCode providers/tools
  ocAllProviders: ProviderInfo | null
  ocProviderAuth: Record<string, ProviderAuthMethod[]> | null
  ocToolIds: string[]
  ocTools: ToolInfo[]

  setOcMcpStatus: (status: Record<string, McpServerStatus> | null) => void
  setOcMcpResources: (resources: Record<string, McpResource> | null) => void
  setOcAllProviders: (providers: ProviderInfo | null) => void
  setOcProviderAuth: (auth: Record<string, ProviderAuthMethod[]> | null) => void
  setOcToolIds: (ids: string[]) => void
  setOcTools: (tools: ToolInfo[]) => void
}

export const useIntegrationsStore = create<IntegrationsState>((set) => ({
  ocMcpStatus: null,
  ocMcpResources: null,
  ocAllProviders: null,
  ocProviderAuth: null,
  ocToolIds: [],
  ocTools: [],

  setOcMcpStatus: (ocMcpStatus) => set({ ocMcpStatus }),
  setOcMcpResources: (ocMcpResources) => set({ ocMcpResources }),
  setOcAllProviders: (ocAllProviders) => set({ ocAllProviders }),
  setOcProviderAuth: (ocProviderAuth) => set({ ocProviderAuth }),
  setOcToolIds: (ocToolIds) => set({ ocToolIds }),
  setOcTools: (ocTools) => set({ ocTools }),
}))

