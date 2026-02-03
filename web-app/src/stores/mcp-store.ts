import { create } from "zustand"

type ClaudeMcpFile = { ok: boolean; path: string; content: string }

type McpState = {
  claudeMcpFile: ClaudeMcpFile | null
  codexMcpStatus: unknown | null

  setClaudeMcpFile: (file: ClaudeMcpFile | null) => void
  setCodexMcpStatus: (status: unknown) => void
}

export const useMcpStore = create<McpState>((set) => ({
  claudeMcpFile: null,
  codexMcpStatus: null,
  setClaudeMcpFile: (file) => set({ claudeMcpFile: file }),
  setCodexMcpStatus: (status) => set({ codexMcpStatus: status }),
}))

