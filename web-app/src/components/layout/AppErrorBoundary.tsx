import * as React from "react"

type AppErrorBoundaryState = {
  error: Error | null
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[AppErrorBoundary]", error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen w-full bg-[var(--background)] px-6 py-10 text-[var(--text)]">
        <div className="mx-auto max-w-xl rounded-xl border border-[var(--border-subtle)] bg-[var(--panel)] p-6 shadow-[var(--shadow-panel)]">
          <div className="text-lg font-semibold">Broski Web crashed</div>
          <div className="mt-2 text-sm text-[var(--text-muted)]">
            This usually happens due to a UI render loop or invalid state. Check the browser console for the stack trace.
          </div>
          <div className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 font-mono text-xs text-[var(--text-secondary)]">
            {error.name}: {error.message}
          </div>
          <div className="mt-5 flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:bg-[var(--accent-hover)] transition-colors"
            >
              Reload
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-[var(--border-subtle)] bg-transparent px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}

