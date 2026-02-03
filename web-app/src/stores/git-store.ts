import { create } from "zustand"

import type { FileStatusInfo, VcsInfo, Worktree } from "@/core/types"

type GitState = {
  vcs: VcsInfo | null
  fileStatus: FileStatusInfo[]
  worktrees: Worktree[]
  selectedPath: string | null
  diffByPath: Record<string, { diff: string; staged?: boolean }>

  setVcs: (vcs: VcsInfo) => void
  setFileStatus: (status: FileStatusInfo[]) => void
  setWorktrees: (worktrees: Worktree[]) => void
  setSelectedPath: (path: string | null) => void
  setGitDiff: (path: string | null, diff: string, staged?: boolean) => void
}

export const useGitStore = create<GitState>((set) => ({
  vcs: null,
  fileStatus: [],
  worktrees: [],
  selectedPath: null,
  diffByPath: {},
  setVcs: (vcs) => set({ vcs }),
  setFileStatus: (fileStatus) => set({ fileStatus }),
  setWorktrees: (worktrees) => set({ worktrees }),
  setSelectedPath: (selectedPath) => set({ selectedPath }),
  setGitDiff: (path, diff, staged) =>
    set((s) => ({
      diffByPath: {
        ...s.diffByPath,
        [path ?? "__repo__"]: { diff, staged },
      },
    })),
}))
