import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/core/constants"
import type { ProjectSummary } from "@/core/types"

type ProjectsState = {
  projects: ProjectSummary[]
  selectedProjectPath: string | null

  setProjects: (projects: ProjectSummary[]) => void
  selectProject: (projectPath: string | null) => void
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set) => ({
      projects: [],
      selectedProjectPath: null,

      setProjects: (projects) => {
        // Deduplicate by path to prevent React duplicate key warnings
        const seen = new Set<string>()
        const deduped = projects.filter((p) => {
          if (seen.has(p.path)) return false
          seen.add(p.path)
          return true
        })
        set({ projects: deduped })
      },
      selectProject: (projectPath) => set({ selectedProjectPath: projectPath }),
    }),
    { name: STORAGE_KEYS.selectedProject }
  )
)

