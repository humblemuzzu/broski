import { create } from "zustand"

export type RightPanelMode = "activity" | "config"

type UiState = {
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
  rightPanelMode: RightPanelMode
  setSidebarCollapsed: (collapsed: boolean) => void
  setRightPanelOpen: (open: boolean) => void
  setRightPanelMode: (mode: RightPanelMode) => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  rightPanelOpen: true,
  rightPanelMode: "activity",
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
  toggleSidebar: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleRightPanel: () =>
    set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
}))
