import * as React from "react"
import { Search } from "lucide-react"

import type { ChatToolCall } from "@/stores/chat-store"
import { BaseToolCard } from "./BaseToolCard"

export interface WebSearchCardProps {
  toolCall: ChatToolCall
}

type WebSearchResult = {
  title?: string
  url?: string
  snippet?: string
  source?: string
}

function safeParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function parseWebSearchResults(output: unknown): WebSearchResult[] | null {
  const obj = (() => {
    if (!output) return null
    if (typeof output === "string") {
      const trimmed = output.trim()
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return safeParseJson(trimmed)
      }
      return null
    }
    if (typeof output === "object") return output
    return null
  })()

  if (!obj) return null
  if (Array.isArray(obj)) {
    return obj
      .map((r) => (r && typeof r === "object" ? (r as any) : null))
      .filter(Boolean)
      .map((r: any) => ({
        title: typeof r.title === "string" ? r.title : typeof r.name === "string" ? r.name : undefined,
        url: typeof r.url === "string" ? r.url : typeof r.link === "string" ? r.link : undefined,
        snippet: typeof r.snippet === "string" ? r.snippet : typeof r.description === "string" ? r.description : undefined,
        source: typeof r.source === "string" ? r.source : undefined,
      }))
      .filter((r) => r.title || r.url || r.snippet)
  }

  const anyObj = obj as any
  const rawResults =
    (Array.isArray(anyObj.results) && anyObj.results) ||
    (Array.isArray(anyObj.items) && anyObj.items) ||
    (Array.isArray(anyObj.data) && anyObj.data) ||
    null
  if (!rawResults) return null
  return rawResults
    .map((r: any) => ({
      title:
        typeof r?.title === "string"
          ? r.title
          : typeof r?.name === "string"
            ? r.name
            : undefined,
      url:
        typeof r?.url === "string"
          ? r.url
          : typeof r?.link === "string"
            ? r.link
            : undefined,
      snippet:
        typeof r?.snippet === "string"
          ? r.snippet
          : typeof r?.description === "string"
            ? r.description
            : undefined,
      source: typeof r?.source === "string" ? r.source : undefined,
    }))
    .filter((r: any) => r.title || r.url || r.snippet)
}

export const WebSearchCard = React.memo(function WebSearchCard({
  toolCall,
}: WebSearchCardProps) {
  const query = React.useMemo(() => {
    if (!toolCall.input || typeof toolCall.input !== "object") return null
    const input = toolCall.input as Record<string, unknown>
    return (
      (input.query as string | undefined) ??
      (input.q as string | undefined) ??
      (input.search as string | undefined) ??
      null
    )
  }, [toolCall.input])

  const webResults = React.useMemo(() => {
    return parseWebSearchResults(toolCall.output)
  }, [toolCall.output])

  return (
    <BaseToolCard
      icon={Search}
      title={toolCall.tool}
      subtitle={query || undefined}
      status={toolCall.status as "running" | "done" | "error"}
      expandable={!!(webResults && webResults.length > 0)}
      defaultExpanded={true}
    >
      {webResults && webResults.length > 0 ? (
        <div className="space-y-2">
          {webResults.slice(0, 8).map((r, idx) => (
            <div
              key={`${r.url ?? r.title ?? "result"}:${idx}`}
              className="rounded-md border border-border bg-[var(--panel)] p-2"
            >
              <div className="text-xs font-semibold">
                {r.title ?? "Result"}
              </div>
              {r.url ? (
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {r.url}
                </div>
              ) : null}
              {r.snippet ? (
                <div className="mt-2 whitespace-pre-wrap text-[11px] text-muted-foreground">
                  {r.snippet}
                </div>
              ) : null}
            </div>
          ))}
          {webResults.length > 8 ? (
            <div className="text-[11px] text-muted-foreground">
              +{webResults.length - 8} more…
            </div>
          ) : null}
        </div>
      ) : toolCall.output ? (
        <pre className="max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
          {typeof toolCall.output === "string"
            ? toolCall.output
            : JSON.stringify(toolCall.output, null, 2)}
        </pre>
      ) : null}
    </BaseToolCard>
  )
})