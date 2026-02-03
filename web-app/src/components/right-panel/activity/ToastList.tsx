import * as React from "react"
import { Button } from "@/components/ui/button"

interface Toast {
  id: string
  title: string
  message?: string
  createdAt: number
}

interface ToastListProps {
  toasts: Toast[]
  onDismissToast: (id: string) => void
}

export const ToastList = React.memo<ToastListProps>(function ToastList({
  toasts,
  onDismissToast,
}) {
  if (toasts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-[var(--panel)] p-4 text-sm text-muted-foreground">
        No activity yet.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-lg border border-border bg-[var(--panel)] p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {t.title}
              </div>
              {t.message ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {t.message}
                </div>
              ) : null}
              <div className="mt-2 text-[11px] text-muted-foreground">
                {new Date(t.createdAt).toLocaleTimeString()}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDismissToast(t.id)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
})