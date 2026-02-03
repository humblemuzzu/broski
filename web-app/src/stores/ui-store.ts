import { create } from "zustand"

export type RightPanelMode = "activity" | "config"

type UiState = {
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
  rightPanelMode: RightPanelMode
  commandPaletteOpen: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  setRightPanelOpen: (open: boolean) => void
  setRightPanelMode: (mode: RightPanelMode) => void
  setCommandPaletteOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  toggleCommandPalette: () => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  rightPanelOpen: true,
  rightPanelMode: "activity",
  commandPaletteOpen: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleRightPanel: () =>
    set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
}))
