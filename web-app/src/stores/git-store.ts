import { create } from "zustand"

import type { FileStatusInfo, VcsInfo } from "@/core/types"

type GitState = {
  vcs: VcsInfo | null
  fileStatus: FileStatusInfo[]

  setVcs: (vcs: VcsInfo) => void
  setFileStatus: (status: FileStatusInfo[]) => void
}

export const useGitStore = create<GitState>((set) => ({
  vcs: null,
  fileStatus: [],
  setVcs: (vcs) => set({ vcs }),
  setFileStatus: (fileStatus) => set({ fileStatus }),
}))

