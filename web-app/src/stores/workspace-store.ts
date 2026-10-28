import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { MosaicNode } from "react-mosaic-component"

import { STORAGE_KEYS } from "@/core/constants"

type WorkspaceState = {
  activeProjectKey: string
  layoutByProject: Record<string, MosaicNode<string>>
  layout: MosaicNode<string>

  setActiveProjectKey: (projectPath: string | null) => void
  setLayout: (layout: MosaicNode<string> | null) => void
  openChat: (agent: string, sessionId: string) => void
  openPanel: (panelId: string) => void
}

const defaultLayout: MosaicNode<string> = {
  direction: "row",
  first: "dashboard",
  second: "new:main",
  splitPercentage: 42,
}

function collectLeafIds(node: MosaicNode<string> | null): string[] {
  if (!node) return []
  if (typeof node === "string") return [node]
  return [...collectLeafIds(node.first), ...collectLeafIds(node.second)]
}

function ensureUniqueId(layout: MosaicNode<string> | null, baseId: string): string {
  const leaves = new Set(collectLeafIds(layout))
  if (!leaves.has(baseId)) return baseId
  return `${baseId}#${Math.random().toString(16).slice(2)}`
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      activeProjectKey: "",
      layoutByProject: { "": defaultLayout },
      layout: defaultLayout,

      setActiveProjectKey: (projectPath) =>
        set((s) => {
          const key = projectPath ?? ""
          const nextLayout = s.layoutByProject[key] ?? defaultLayout
          return {
            activeProjectKey: key,
            layout: nextLayout,
            layoutByProject: {
              ...s.layoutByProject,
              [key]: nextLayout,
            },
          }
        }),

      setLayout: (layout) =>
        set((s) => {
          const next = (layout ?? defaultLayout) as MosaicNode<string>
          return {
            layout: next,
            layoutByProject: {
              ...s.layoutByProject,
              [s.activeProjectKey]: next,
            },
          }
        }),

      openChat: (agent, sessionId) => {
        const base = `chat:${agent}:${sessionId}`
        const unique = ensureUniqueId(get().layout, base)
        get().openPanel(unique)
      },

      openPanel: (panelId) =>
        set((s) => {
          const unique = ensureUniqueId(s.layout, panelId)
          const root = s.layout ?? defaultLayout
          // Simple strategy: add panels by splitting root.
          const nextLayout: MosaicNode<string> = {
            direction: "row",
            first: root,
            second: unique,
            splitPercentage: 65,
          }
          return {
            layout: nextLayout,
            layoutByProject: {
              ...s.layoutByProject,
              [s.activeProjectKey]: nextLayout,
            },
          }
        }),
    }),
    {
      name: STORAGE_KEYS.workspaceLayout,
      partialize: (s) => ({
        activeProjectKey: s.activeProjectKey,
        layoutByProject: s.layoutByProject,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<WorkspaceState> | undefined
        const layoutByProject = p?.layoutByProject ?? current.layoutByProject
        const activeProjectKey = p?.activeProjectKey ?? current.activeProjectKey
        return {
          ...current,
          activeProjectKey,
          layoutByProject,
          layout: layoutByProject[activeProjectKey] ?? current.layout,
        }
      },
    }
  )
)
