import { create } from "zustand"

import type { PtySession } from "@/core/types"

type OutputState = {
  seq: number
  lastChunk: string
  error?: string
  exitCode?: number
}

type TerminalState = {
  ptys: Record<string, PtySession>
  activePtyId: string | null
  outputByPty: Record<string, OutputState>

  setPtys: (ptys: PtySession[]) => void
  upsertPty: (pty: PtySession) => void
  removePty: (ptyId: string) => void
  setActivePtyId: (ptyId: string | null) => void

  appendOutput: (ptyId: string, chunk: string) => void
  setPtyError: (ptyId: string, error: string) => void
  markExited: (ptyId: string, exitCode?: number) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  ptys: {},
  activePtyId: null,
  outputByPty: {},

  setPtys: (ptys) =>
    set((s) => {
      const next: Record<string, PtySession> = { ...s.ptys }
      for (const p of ptys) next[p.id] = p
      return { ptys: next }
    }),

  upsertPty: (pty) =>
    set((s) => ({
      ptys: { ...s.ptys, [pty.id]: pty },
    })),

  removePty: (ptyId) =>
    set((s) => {
      const { [ptyId]: _, ...rest } = s.ptys
      const { [ptyId]: __, ...restOut } = s.outputByPty
      const activePtyId = s.activePtyId === ptyId ? null : s.activePtyId
      return { ptys: rest, outputByPty: restOut, activePtyId }
    }),

  setActivePtyId: (ptyId) => set({ activePtyId: ptyId }),

  appendOutput: (ptyId, chunk) =>
    set((s) => ({
      outputByPty: {
        ...s.outputByPty,
        [ptyId]: {
          ...(s.outputByPty[ptyId] ?? { seq: 0, lastChunk: "" }),
          seq: (s.outputByPty[ptyId]?.seq ?? 0) + 1,
          lastChunk: chunk,
        },
      },
    })),

  setPtyError: (ptyId, error) =>
    set((s) => ({
      outputByPty: {
        ...s.outputByPty,
        [ptyId]: {
          ...(s.outputByPty[ptyId] ?? { seq: 0, lastChunk: "" }),
          error,
        },
      },
    })),

  markExited: (ptyId, exitCode) =>
    set((s) => ({
      outputByPty: {
        ...s.outputByPty,
        [ptyId]: {
          ...(s.outputByPty[ptyId] ?? { seq: 0, lastChunk: "" }),
          exitCode,
        },
      },
    })),
}))

