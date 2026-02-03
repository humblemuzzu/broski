import { create } from "zustand"

export type ToastItem = {
  id: string
  kind: "info" | "success" | "warning" | "error"
  title: string
  message?: string
  createdAt: number
}

type ActivityState = {
  toasts: ToastItem[]
  pushToast: (toast: Omit<ToastItem, "id" | "createdAt">) => void
  dismissToast: (id: string) => void
  clear: () => void
}

export const useActivityStore = create<ActivityState>((set) => ({
  toasts: [],
  pushToast: (t) =>
    set((s) => ({
      toasts: [
        {
          id: `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
          createdAt: Date.now(),
          ...t,
        },
        ...s.toasts,
      ].slice(0, 200),
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}))

