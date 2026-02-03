export function PlaceholderPanel({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="h-full w-full p-4">
      <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-4">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {description ?? "Coming next in the web app plan."}
        </div>
      </div>
    </div>
  )
}

