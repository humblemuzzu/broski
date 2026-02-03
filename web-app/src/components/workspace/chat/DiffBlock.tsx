import * as React from "react"

type ParsedLine =
  | { kind: "meta"; text: string }
  | { kind: "hunk"; text: string }
  | {
      kind: "add" | "del" | "context"
      text: string
      oldNo: number | null
      newNo: number | null
    }

function parseUnifiedDiff(diff: string): ParsedLine[] {
  const out: ParsedLine[] = []
  let oldNo: number | null = null
  let newNo: number | null = null

  const lines = diff.replace(/\r\n/g, "\n").split("\n")
  for (const rawLine of lines) {
    const line = rawLine ?? ""
    if (line.startsWith("@@")) {
      const m = /@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/.exec(
        line
      )
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[3])
      }
      out.push({ kind: "hunk", text: line })
      continue
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      out.push({ kind: "meta", text: line })
      continue
    }
    if (line.startsWith("\\ No newline")) {
      out.push({ kind: "meta", text: line })
      continue
    }

    if (line.startsWith("+")) {
      out.push({ kind: "add", text: line, oldNo: null, newNo })
      if (newNo != null) newNo += 1
      continue
    }
    if (line.startsWith("-")) {
      out.push({ kind: "del", text: line, oldNo, newNo: null })
      if (oldNo != null) oldNo += 1
      continue
    }
    if (line.startsWith(" ")) {
      out.push({ kind: "context", text: line, oldNo, newNo })
      if (oldNo != null) oldNo += 1
      if (newNo != null) newNo += 1
      continue
    }

    // Fallback: treat as meta (covers "diff --git", "index", etc.)
    out.push({ kind: "meta", text: line })
  }

  return out
}

export function DiffBlock({ diff }: { diff: string }) {
  const parsed = React.useMemo(() => parseUnifiedDiff(diff), [diff])
  return (
    <div className="mt-2 max-h-[320px] overflow-auto rounded-md border border-border bg-black/10">
      <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
        <tbody>
          {parsed.map((l, idx) => {
            if (l.kind === "meta" || l.kind === "hunk") {
              return (
                <tr key={idx}>
                  <td
                    colSpan={3}
                    className={[
                      "px-2 py-1",
                      l.kind === "hunk"
                        ? "bg-black/20 text-xs text-foreground"
                        : "text-muted-foreground",
                    ].join(" ")}
                  >
                    <span className="whitespace-pre">{l.text || " "}</span>
                  </td>
                </tr>
              )
            }
            else {
              const rowCls =
                l.kind === "add"
                  ? "bg-emerald-500/10 text-emerald-200"
                  : l.kind === "del"
                    ? "bg-rose-500/10 text-rose-200"
                    : "text-muted-foreground"
              const lnCls =
                "w-[1%] select-none px-2 py-0.5 text-right opacity-60"
              return (
                <tr key={idx} className={rowCls}>
                  <td className={lnCls}>{l.oldNo ?? ""}</td>
                  <td className={lnCls}>{l.newNo ?? ""}</td>
                  <td className="px-2 py-0.5">
                    <span className="whitespace-pre">{l.text || " "}</span>
                  </td>
                </tr>
              )
            }
          })}
        </tbody>
      </table>
    </div>
  )
}
