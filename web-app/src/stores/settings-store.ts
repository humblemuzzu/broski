import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/core/constants"

type SettingsState = {
  autoOpenCodexSpawns: boolean
  setAutoOpenCodexSpawns: (enabled: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoOpenCodexSpawns: false,
      setAutoOpenCodexSpawns: (enabled) => set({ autoOpenCodexSpawns: enabled }),
    }),
    {
      name: STORAGE_KEYS.settings,
      partialize: (s) => ({ autoOpenCodexSpawns: s.autoOpenCodexSpawns }),
    }
  )
)

