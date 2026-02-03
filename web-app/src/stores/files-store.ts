import { create } from "zustand"

import type { FileContent } from "@/core/types"

export type BrowseItem = {
  name?: string
  path?: string
  kind?: string
  type?: string
  isDir?: boolean
  isFile?: boolean
  size?: number
} & Record<string, unknown>

type FilesState = {
  cwdPath: string | null
  items: BrowseItem[]
  selectedFilePath: string | null
  fileContent: FileContent | null

  setBrowseResult: (path: string, items: unknown[]) => void
  selectFile: (path: string | null) => void
  setFileContent: (path: string, content: FileContent) => void
}

export const useFilesStore = create<FilesState>((set) => ({
  cwdPath: null,
  items: [],
  selectedFilePath: null,
  fileContent: null,

  setBrowseResult: (path, items) =>
    set({
      cwdPath: path,
      items: items as BrowseItem[],
    }),

  selectFile: (path) => set({ selectedFilePath: path }),

  setFileContent: (path, content) =>
    set((s) => ({
      selectedFilePath: path,
      fileContent: content,
      // keep items/cwdPath
      items: s.items,
      cwdPath: s.cwdPath,
    })),
}))

