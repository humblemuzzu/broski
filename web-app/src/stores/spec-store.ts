import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/core/constants"

type SpecState = {
  specByProject: Record<string, string>
  setSpec: (projectPath: string, markdown: string) => void
  getSpec: (projectPath: string) => string
}

export const useSpecStore = create<SpecState>()(
  persist(
    (set, get) => ({
      specByProject: {},
      setSpec: (projectPath, markdown) =>
        set((s) => ({
          specByProject: {
            ...s.specByProject,
            [projectPath]: markdown,
          },
        })),
      getSpec: (projectPath) => get().specByProject[projectPath] ?? "",
    }),
    {
      name: STORAGE_KEYS.specByProject,
      partialize: (s) => ({ specByProject: s.specByProject }),
    }
  )
)

