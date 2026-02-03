export function SpecPanel({ projectPath }: { projectPath: string }) {
  return (
    <div className="h-full w-full p-4">
      <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-4">
        <div className="text-sm font-semibold">Spec</div>
        <div className="mt-1 text-xs text-muted-foreground">{projectPath}</div>
        <div className="mt-3 text-sm text-muted-foreground">
          Next: markdown editor/preview + link to session context.
        </div>
      </div>
    </div>
  )
}

