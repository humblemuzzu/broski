import { create } from "zustand"

export type CodexCollabEvent = {
  id: string
  threadId: string
  type: string
  createdAt: number
  data: unknown
}

type CodexCollabState = {
  eventsByThread: Record<string, CodexCollabEvent[]>
  addEvent: (threadId: string, type: string, data: unknown) => void
  clearThread: (threadId: string) => void
}

export const useCodexCollabStore = create<CodexCollabState>((set) => ({
  eventsByThread: {},
  addEvent: (threadId, type, data) =>
    set((s) => {
      const list = s.eventsByThread[threadId] ?? []
      const id = `${threadId}:${type}:${Date.now()}:${Math.random().toString(16).slice(2)}`
      const next: CodexCollabEvent = {
        id,
        threadId,
        type,
        createdAt: Date.now(),
        data,
      }
      return {
        eventsByThread: {
          ...s.eventsByThread,
          [threadId]: [...list, next].slice(-800),
        },
      }
    }),
  clearThread: (threadId) =>
    set((s) => ({
      eventsByThread: {
        ...s.eventsByThread,
        [threadId]: [],
      },
    })),
}))

