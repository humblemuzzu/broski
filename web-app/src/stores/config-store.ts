import { create } from "zustand"

type ConfigState = {
  // OpenCode (bridge "core" agent)
  openCodeProviders: unknown | null
  openCodeConfig: unknown | null

  // Claude Code
  claudeCodeConfig: unknown | null
  claudeCodeSkills: unknown | null

  // Codex
  codexModels: unknown | null
  codexConfig: unknown | null
  codexSkills: unknown | null

  setOpenCodeProviders: (providers: unknown) => void
  setOpenCodeConfig: (config: unknown) => void
  setClaudeCodeConfig: (config: unknown) => void
  setClaudeCodeSkills: (skills: unknown) => void
  setCodexModels: (models: unknown) => void
  setCodexConfig: (config: unknown) => void
  setCodexSkills: (skills: unknown) => void
}

export const useConfigStore = create<ConfigState>((set) => ({
  openCodeProviders: null,
  openCodeConfig: null,
  claudeCodeConfig: null,
  claudeCodeSkills: null,
  codexModels: null,
  codexConfig: null,
  codexSkills: null,

  setOpenCodeProviders: (providers) => set({ openCodeProviders: providers }),
  setOpenCodeConfig: (config) => set({ openCodeConfig: config }),
  setClaudeCodeConfig: (config) => set({ claudeCodeConfig: config }),
  setClaudeCodeSkills: (skills) => set({ claudeCodeSkills: skills }),
  setCodexModels: (models) => set({ codexModels: models }),
  setCodexConfig: (config) => set({ codexConfig: config }),
  setCodexSkills: (skills) => set({ codexSkills: skills }),
}))

