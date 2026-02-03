import * as React from "react"
import { ArrowRight, Network, RefreshCw } from "lucide-react"

import { useCodexCollabStore } from "@/stores/codex-collab-store"
import { useConnectionStore } from "@/stores/connection-store"
import { useWorkspaceStore } from "@/stores/workspace-store"
import { useSettingsStore } from "@/stores/settings-store"
import { Button } from "@/components/ui/button"

function summarizeStatus(status: any): string {
  const t = status?.type
  if (t === "completed") return `completed${status?.message ? `: ${status.message}` : ""}`
  if (t === "errored") return `errored: ${status?.error ?? ""}`
  if (t === "running") return "running"
  if (t === "pending_init") return "pending"
  if (t === "shutdown") return "shutdown"
  return t ? String(t) : ""
}

function prettyEvent(type: string, data: any): string {
  if (type === "collab_spawn_begin") return `Spawn begin · callId=${data?.callId ?? ""}`
  if (type === "collab_spawn_end") {
    const status = summarizeStatus(data?.status)
    return `Spawn end · newThread=${data?.newThreadId ?? "?"} · ${status}`
  }
  if (type === "collab_interaction_begin") {
    return `Interaction begin · ${data?.senderThreadId ?? "?"} → ${data?.receiverThreadId ?? "?"}`
  }
  if (type === "collab_interaction_end") {
    const status = summarizeStatus(data?.status)
    return `Interaction end · ${data?.senderThreadId ?? "?"} → ${data?.receiverThreadId ?? "?"} · ${status}`
  }
  if (type === "collab_waiting_begin") {
    const n = Array.isArray(data?.receiverThreadIds) ? data.receiverThreadIds.length : 0
    return `Waiting begin · ${n} agent(s)`
  }
  if (type === "collab_waiting_end") return `Waiting end`
  if (type === "collab_close_begin") return `Close begin · ${data?.receiverThreadId ?? "?"}`
  if (type === "collab_close_end") {
    const status = summarizeStatus(data?.status)
    return `Close end · ${data?.receiverThreadId ?? "?"} · ${status}`
  }
  return type
}

export function CodexCollabPanel({ threadId }: { threadId: string }) {
  const send = useConnectionStore((s) => s.send)
  const events = useCodexCollabStore((s) => s.eventsByThread[threadId] ?? [])
  const clearThread = useCodexCollabStore((s) => s.clearThread)
  const openChat = useWorkspaceStore((s) => s.openChat)
  const autoOpenCodexSpawns = useSettingsStore((s) => s.autoOpenCodexSpawns)
  const setAutoOpenCodexSpawns = useSettingsStore((s) => s.setAutoOpenCodexSpawns)

  const summary = React.useMemo(() => {
    const statusByThread = new Map<string, string>()
    const noteByThread = new Map<string, string>()
    const ensure = (id: any) => (typeof id === "string" && id.trim().length > 0 ? id : null)

    for (const e of events) {
      if (e.type === "collab_spawn_end") {
        const d: any = e.data
        const child = ensure(d?.newThreadId)
        const st = d?.status
        if (child) {
          const stStr = summarizeStatus(st)
          if (stStr) statusByThread.set(child, stStr)
          if (typeof d?.prompt === "string" && d.prompt.trim()) {
            noteByThread.set(child, d.prompt.trim().slice(0, 120))
          }
        }
      }
      if (e.type === "collab_waiting_end") {
        const d: any = e.data
        const statuses = d?.statuses ?? {}
        if (statuses && typeof statuses === "object") {
          for (const [tid, st] of Object.entries(statuses)) {
            const id = ensure(tid)
            if (!id) continue
            const stStr = summarizeStatus(st)
            if (stStr) statusByThread.set(id, stStr)
          }
        }
      }
      if (e.type === "collab_interaction_end") {
        const d: any = e.data
        const id = ensure(d?.receiverThreadId)
        if (id) {
          const stStr = summarizeStatus(d?.status)
          if (stStr) statusByThread.set(id, stStr)
        }
      }
      if (e.type === "collab_close_end") {
        const d: any = e.data
        const id = ensure(d?.receiverThreadId)
        if (id) {
          const stStr = summarizeStatus(d?.status)
          if (stStr) statusByThread.set(id, stStr)
        }
      }
    }

    const allThreads = new Set<string>()
    for (const e of events) {
      const d: any = e.data
      if (typeof d?.senderThreadId === "string") allThreads.add(d.senderThreadId)
      if (typeof d?.receiverThreadId === "string") allThreads.add(d.receiverThreadId)
      if (typeof d?.newThreadId === "string") allThreads.add(d.newThreadId)
      if (Array.isArray(d?.receiverThreadIds)) {
        for (const x of d.receiverThreadIds) if (typeof x === "string") allThreads.add(x)
      }
    }
    allThreads.add(threadId)

    const counts = { running: 0, completed: 0, errored: 0, pending: 0, other: 0 }
    for (const id of allThreads) {
      const st = statusByThread.get(id) ?? ""
      if (st.startsWith("running")) counts.running++
      else if (st.startsWith("completed")) counts.completed++
      else if (st.startsWith("errored")) counts.errored++
      else if (st.startsWith("pending")) counts.pending++
      else counts.other++
    }

    return { counts, statusByThread, noteByThread, total: allThreads.size }
  }, [events, threadId])

  const derivedThreads = React.useMemo(() => {
    const ids = new Set<string>()
    ids.add(threadId)
    for (const e of events) {
      const d: any = e.data
      if (typeof d?.senderThreadId === "string") ids.add(d.senderThreadId)
      if (typeof d?.receiverThreadId === "string") ids.add(d.receiverThreadId)
      if (Array.isArray(d?.receiverThreadIds)) {
        for (const x of d.receiverThreadIds) if (typeof x === "string") ids.add(x)
      }
      if (typeof d?.newThreadId === "string") ids.add(d.newThreadId)
    }
    return Array.from(ids)
  }, [events, threadId])

  const spawnTree = React.useMemo(() => {
    type Node = { id: string; children: string[] }
    const childrenByParent = new Map<string, Set<string>>()
    const known = new Set<string>([threadId])

    for (const e of events) {
      if (e.type !== "collab_spawn_end") continue
      const d: any = e.data
      const parent = typeof d?.senderThreadId === "string" ? d.senderThreadId : null
      const child = typeof d?.newThreadId === "string" ? d.newThreadId : null
      if (!parent || !child) continue
      known.add(parent)
      known.add(child)
      const set = childrenByParent.get(parent) ?? new Set<string>()
      set.add(child)
      childrenByParent.set(parent, set)
    }

    const build = (id: string): Node => ({
      id,
      children: Array.from(childrenByParent.get(id) ?? []).sort(),
    })

    // Root at current threadId (even if it wasn't the original parent).
    return build(threadId)
  }, [events, threadId])

  const flattenedTree = React.useMemo(() => {
    const out: Array<{ id: string; depth: number }> = []
    const visit = (id: string, depth: number) => {
      out.push({ id, depth })
      const kids = (spawnTree.id === id ? spawnTree.children : []) as string[]
      // For nested children, scan events-derived map by recomputing quickly
      // (keeps this panel standalone without extra store shape).
      const childSet = new Set<string>()
      for (const e of events) {
        if (e.type !== "collab_spawn_end") continue
        const d: any = e.data
        if (d?.senderThreadId === id && typeof d?.newThreadId === "string") childSet.add(d.newThreadId)
      }
      const children = Array.from(childSet.size ? childSet : new Set(kids)).sort()
      for (const c of children) visit(c, depth + 1)
    }
    visit(spawnTree.id, 0)
    // Deduplicate while keeping first occurrence
    const seen = new Set<string>()
    return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  }, [events, spawnTree.children, spawnTree.id])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] bg-[var(--panel-header)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Codex Multi-Agent</div>
            <div className="mt-1 text-xs text-muted-foreground">thread: {threadId}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              send({ type: "cx_get_thread_messages", threadId } as any)
              send({ type: "cx_list_threads", refresh: true } as any)
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <label className="flex select-none items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={autoOpenCodexSpawns}
              onChange={(e) => setAutoOpenCodexSpawns(e.target.checked)}
            />
            auto-open spawns
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              for (const t of derivedThreads) openChat("codex", t)
            }}
          >
            Open All Chats
          </Button>
          <Button size="sm" variant="outline" onClick={() => clearThread(threadId)}>
            Clear
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[320px] shrink-0 border-r border-[var(--panel-border)] p-3">
          <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">Summary</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border bg-card p-2">
                <div className="text-[11px] text-muted-foreground">threads</div>
                <div className="text-sm font-semibold">{summary.total}</div>
              </div>
              <div className="rounded-md border border-border bg-card p-2">
                <div className="text-[11px] text-muted-foreground">running</div>
                <div className="text-sm font-semibold">{summary.counts.running}</div>
              </div>
              <div className="rounded-md border border-border bg-card p-2">
                <div className="text-[11px] text-muted-foreground">completed</div>
                <div className="text-sm font-semibold">{summary.counts.completed}</div>
              </div>
              <div className="rounded-md border border-border bg-card p-2">
                <div className="text-[11px] text-muted-foreground">errored</div>
                <div className="text-sm font-semibold">{summary.counts.errored}</div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">Spawn Tree</div>
            <div className="mt-2 space-y-1">
              {flattenedTree.map((row) => (
                <button
                  key={row.id}
                  className="w-full rounded-md border border-border bg-card px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => openChat("codex", row.id)}
                >
                  <div className="truncate font-semibold" style={{ paddingLeft: `${row.depth * 12}px` }}>
                    {row.id}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {summary.statusByThread.get(row.id) ?? "Open chat"}
                  </div>
                </button>
              ))}
              {flattenedTree.length === 0 ? (
                <div className="text-sm text-muted-foreground">None.</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-auto p-3">
          <div className="rounded-lg border border-[var(--panel-border)] bg-[var(--panel)] p-3">
            <div className="text-xs font-semibold text-muted-foreground">
              Timeline ({events.length})
            </div>
            <div className="mt-3 space-y-2">
              {events.map((e) => (
                <div key={e.id} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {prettyEvent(e.type, e.data as any)}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {new Date(e.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] text-muted-foreground">
                      {e.type.replace("collab_", "")}
                    </div>
                  </div>
                  {e.type === "collab_spawn_end" && (e.data as any)?.newThreadId ? (
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openChat("codex", String((e.data as any).newThreadId))}
                      >
                        <ArrowRight className="mr-2 h-4 w-4" />
                        Open spawned thread
                      </Button>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {(e.data as any).senderThreadId} → {(e.data as any).newThreadId}
                      </div>
                    </div>
                  ) : null}
                  {(e.data as any)?.prompt ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">
                        Prompt
                      </summary>
                      <div className="mt-2 whitespace-pre-wrap rounded-md bg-black/20 p-2 text-[11px]">
                        {(e.data as any).prompt}
                      </div>
                    </details>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                      Data
                    </summary>
                    <pre className="mt-2 max-h-[220px] overflow-auto rounded-md bg-black/20 p-2 text-[11px]">
                      {JSON.stringify(e.data, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
              {events.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No multi-agent events captured yet. Run Codex with collaboration enabled.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
