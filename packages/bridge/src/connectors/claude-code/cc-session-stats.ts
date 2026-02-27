/**
 * Claude Code session diff statistics.
 * Scans .jsonl transcript files to compute per-session code change summaries.
 * Cached by sessionId:mtime to avoid re-scanning unchanged files.
 */

import { stat } from 'node:fs/promises'
import type { SessionDiffSummary } from '../../handlers/session-stats'
import { aggregateFileDiffs } from '../../handlers/session-stats'

// Cache: `sessionId:mtime` → summary
const statsCache = new Map<string, { mtime: number; summary: SessionDiffSummary }>()

/**
 * Compute diff stats for a single CC session by scanning its .jsonl transcript.
 * Uses toolUseResult entries (same data source as the streaming diff viewer).
 * Returns null if the file can't be read.
 */
export async function computeCCSessionStats(
  filePath: string,
  sessionId: string,
): Promise<SessionDiffSummary | null> {
  try {
    const fileStat = await stat(filePath)
    const mtime = fileStat.mtime.getTime()

    // Check cache
    const cached = statsCache.get(sessionId)
    if (cached && cached.mtime === mtime) {
      return cached.summary
    }

    // Read and scan the full file
    const text = await Bun.file(filePath).text()
    const lines = text.split('\n')

    const fileDiffs: Array<{ file: string; additions: number; deletions: number }> = []

    for (const line of lines) {
      if (!line) continue
      // Quick string check before parsing - toolUseResult only appears on tool_result lines
      if (!line.includes('toolUseResult')) continue

      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      const toolUseResult = parsed?.toolUseResult
      if (!toolUseResult || typeof toolUseResult !== 'object') continue

      const filePath = toolUseResult.filePath as string | undefined
      if (!filePath) continue

      // Extract additions/deletions from structuredPatch (preferred)
      const structuredPatch = toolUseResult.structuredPatch
      if (Array.isArray(structuredPatch) && structuredPatch.length > 0) {
        let additions = 0
        let deletions = 0
        for (const hunk of structuredPatch) {
          const hunkLines = Array.isArray(hunk?.lines) ? hunk.lines : []
          for (const l of hunkLines) {
            if (typeof l !== 'string') continue
            if (l.startsWith('+') && !l.startsWith('+++')) additions++
            if (l.startsWith('-') && !l.startsWith('---')) deletions++
          }
        }
        if (additions > 0 || deletions > 0) {
          fileDiffs.push({ file: filePath, additions, deletions })
          continue
        }
      }

      // Fallback: count from old/new string difference
      const oldStr = typeof toolUseResult.oldString === 'string' ? toolUseResult.oldString : ''
      const newStr = typeof toolUseResult.newString === 'string' ? toolUseResult.newString : ''
      if (oldStr || newStr) {
        const oldLines = oldStr ? oldStr.split('\n').length : 0
        const newLines = newStr ? newStr.split('\n').length : 0
        const additions = Math.max(0, newLines - oldLines)
        const deletions = Math.max(0, oldLines - newLines)
        if (additions > 0 || deletions > 0) {
          fileDiffs.push({ file: filePath, additions, deletions })
        }
      }
    }

    const summary = aggregateFileDiffs(fileDiffs)

    // Cache result
    statsCache.set(sessionId, { mtime, summary })

    return summary
  } catch {
    return null
  }
}

/** Clear the stats cache (e.g., on session delete). */
export function clearCCStatsCache(sessionId?: string): void {
  if (sessionId) {
    statsCache.delete(sessionId)
  } else {
    statsCache.clear()
  }
}
