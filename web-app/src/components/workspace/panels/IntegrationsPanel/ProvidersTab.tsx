import * as React from "react"
import { Button } from "@/components/ui/button"

interface ProvidersTabProps {
  allProviders: any
  providerAuth: any
  onListProviders: () => void
  onGetAuth: () => void
  disabled: boolean
}

export const ProvidersTab = React.memo<ProvidersTabProps>(({
  allProviders,
  providerAuth,
  onListProviders,
  onGetAuth,
  disabled,
}) => {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
        <div className="text-xs font-semibold text-muted-foreground">OpenCode Providers</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onListProviders} disabled={disabled}>
            List
          </Button>
          <Button size="sm" variant="outline" onClick={onGetAuth} disabled={disabled}>
            Auth
          </Button>
        </div>

        <details className="mt-3" open>
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Providers payload
          </summary>
          <pre className="mt-2 max-h-[280px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
            {JSON.stringify(allProviders, null, 2)}
          </pre>
        </details>

        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Auth payload
          </summary>
          <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
            {JSON.stringify(providerAuth, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  )
})

ProvidersTab.displayName = "ProvidersTab"