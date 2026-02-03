import { create } from "zustand"
import { persist } from "zustand/middleware"

import { STORAGE_KEYS } from "@/core/constants"

export type PreviewPreset = {
  id: string
  name: string
  url: string
}

type PreviewState = {
  urlByProject: Record<string, string>
  proxyByProject: Record<string, boolean>
  presetsByProject: Record<string, PreviewPreset[]>
  setUrl: (projectPath: string, url: string) => void
  setProxyEnabled: (projectPath: string, enabled: boolean) => void
  getUrl: (projectPath: string) => string
  getProxyEnabled: (projectPath: string) => boolean
  addPreset: (projectPath: string, preset: { name: string; url: string }) => void
  removePreset: (projectPath: string, presetId: string) => void
  renamePreset: (projectPath: string, presetId: string, name: string) => void
  movePreset: (projectPath: string, presetId: string, dir: "up" | "down") => void
}

export const usePreviewStore = create<PreviewState>()(
  persist(
    (set, get) => ({
      urlByProject: {},
      proxyByProject: {},
      presetsByProject: {},
      setUrl: (projectPath, url) =>
        set((s) => ({
          urlByProject: {
            ...s.urlByProject,
            [projectPath]: url,
          },
        })),
      setProxyEnabled: (projectPath, enabled) =>
        set((s) => ({
          proxyByProject: {
            ...s.proxyByProject,
            [projectPath]: enabled,
          },
        })),
      getUrl: (projectPath) => get().urlByProject[projectPath] ?? "http://localhost:3000",
      getProxyEnabled: (projectPath) => Boolean(get().proxyByProject[projectPath]),
      addPreset: (projectPath, preset) =>
        set((s) => {
          const list = s.presetsByProject[projectPath] ?? []
          const next: PreviewPreset = {
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            name: preset.name.trim() || "Preset",
            url: preset.url.trim(),
          }
          return {
            presetsByProject: {
              ...s.presetsByProject,
              [projectPath]: [next, ...list].slice(0, 24),
            },
          }
        }),
      removePreset: (projectPath, presetId) =>
        set((s) => ({
          presetsByProject: {
            ...s.presetsByProject,
            [projectPath]: (s.presetsByProject[projectPath] ?? []).filter((p) => p.id !== presetId),
          },
        })),
      renamePreset: (projectPath, presetId, name) =>
        set((s) => ({
          presetsByProject: {
            ...s.presetsByProject,
            [projectPath]: (s.presetsByProject[projectPath] ?? []).map((p) =>
              p.id === presetId ? { ...p, name: name.trim() || p.name } : p
            ),
          },
        })),
      movePreset: (projectPath, presetId, dir) =>
        set((s) => {
          const list = s.presetsByProject[projectPath] ?? []
          const idx = list.findIndex((p) => p.id === presetId)
          if (idx < 0) return {}
          const nextIdx = dir === "up" ? idx - 1 : idx + 1
          if (nextIdx < 0 || nextIdx >= list.length) return {}
          const copy = list.slice()
          const tmp = copy[idx]
          copy[idx] = copy[nextIdx]!
          copy[nextIdx] = tmp!
          return {
            presetsByProject: {
              ...s.presetsByProject,
              [projectPath]: copy,
            },
          }
        }),
    }),
    {
      name: STORAGE_KEYS.previewByProject,
      partialize: (s) => ({
        urlByProject: s.urlByProject,
        proxyByProject: s.proxyByProject,
        presetsByProject: s.presetsByProject,
      }),
    }
  )
)
