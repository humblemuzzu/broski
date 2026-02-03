import { create } from "zustand"

type NamedFile = { name: string; description?: string; path: string; source?: string; editable?: boolean }

type EditableFile = { name: string; path: string; source?: string; content: string }

type AutomationState = {
  // OpenCode (filesystem-backed)
  ocSkills: NamedFile[]
  ocSkill: EditableFile | null
  ocCommandFiles: NamedFile[]
  ocCommandFile: EditableFile | null
  ocAgentFiles: NamedFile[]
  ocAgentFile: EditableFile | null
  ocPluginFiles: NamedFile[]
  ocPluginFile: EditableFile | null

  // Claude Code
  ccSkills: NamedFile[]
  ccSkill: EditableFile | null
  ccCommands: NamedFile[]
  ccCommand: EditableFile | null
  ccHooksFile: { ok: boolean; source: string; path: string; content: string } | null

  // Codex
  cxSkills: Array<{ name: string; scope?: string; description?: string; path?: string }>
  cxSkill: { name: string; scope: string; path: string; content: string } | null

  setOcSkills: (skills: NamedFile[]) => void
  setOcSkill: (skill: EditableFile | null) => void
  setOcCommandFiles: (files: NamedFile[]) => void
  setOcCommandFile: (file: EditableFile | null) => void
  setOcAgentFiles: (files: NamedFile[]) => void
  setOcAgentFile: (file: EditableFile | null) => void
  setOcPluginFiles: (files: NamedFile[]) => void
  setOcPluginFile: (file: EditableFile | null) => void

  setCcSkills: (skills: NamedFile[]) => void
  setCcSkill: (skill: EditableFile | null) => void
  setCcCommands: (commands: NamedFile[]) => void
  setCcCommand: (command: EditableFile | null) => void
  setCcHooksFile: (hooks: AutomationState["ccHooksFile"]) => void

  setCxSkills: (skills: AutomationState["cxSkills"]) => void
  setCxSkill: (skill: AutomationState["cxSkill"]) => void
}

export const useAutomationStore = create<AutomationState>((set) => ({
  ocSkills: [],
  ocSkill: null,
  ocCommandFiles: [],
  ocCommandFile: null,
  ocAgentFiles: [],
  ocAgentFile: null,
  ocPluginFiles: [],
  ocPluginFile: null,

  ccSkills: [],
  ccSkill: null,
  ccCommands: [],
  ccCommand: null,
  ccHooksFile: null,

  cxSkills: [],
  cxSkill: null,

  setOcSkills: (ocSkills) => set({ ocSkills }),
  setOcSkill: (ocSkill) => set({ ocSkill }),
  setOcCommandFiles: (ocCommandFiles) => set({ ocCommandFiles }),
  setOcCommandFile: (ocCommandFile) => set({ ocCommandFile }),
  setOcAgentFiles: (ocAgentFiles) => set({ ocAgentFiles }),
  setOcAgentFile: (ocAgentFile) => set({ ocAgentFile }),
  setOcPluginFiles: (ocPluginFiles) => set({ ocPluginFiles }),
  setOcPluginFile: (ocPluginFile) => set({ ocPluginFile }),

  setCcSkills: (ccSkills) => set({ ccSkills }),
  setCcSkill: (ccSkill) => set({ ccSkill }),
  setCcCommands: (ccCommands) => set({ ccCommands }),
  setCcCommand: (ccCommand) => set({ ccCommand }),
  setCcHooksFile: (ccHooksFile) => set({ ccHooksFile }),

  setCxSkills: (cxSkills) => set({ cxSkills }),
  setCxSkill: (cxSkill) => set({ cxSkill }),
}))

