/**
 * Pi session diff statistics.
 * Scans Pi .jsonl session files to compute per-session code change summaries.
 * Pi stores messages as JSONL entries. The edit tool produces `details.diff` (unified diff).
 * The write tool creates new files (counted as all-additions).
 * Cached by sessionId:mtime to avoid re-scanning unchanged files.
 */

import { stat } from 'node:fs/promises'
import type { SessionDiffSummary } from '../../handlers/session-stats'
import { aggregateFileDiffs, countUnifiedDiffStats } from '../../handlers/session-stats'

// Cache: sessionPath → { mtime, summary }
const statsCache = new Map<string, { mtime: number; summary: SessionDiffSummary }>()

/**
 * Compute diff stats for a Pi session by scanning its .jsonl file.
 * Extracts data from toolResult messages where toolName is "edit" or "write".
 * Edit tool results have `details.diff` (unified diff string).
 * Write tool results create a file (we count lines written as additions).
 */
export async function computePiSessionStats(
  filePath: string,
): Promise<SessionDiffSummary | null> {
  try {
    const fileStat = await stat(filePath)
    const mtime = fileStat.mtime.getTime()

    // Check cache
    const cached = statsCache.get(filePath)
    if (cached && cached.mtime === mtime) {
      return cached.summary
    }

    const text = await Bun.file(filePath).text()
    // Yield to the event loop between file read and CPU-intensive JSON parsing.
    // Without this, Promise.all fires all reads concurrently and the synchronous
    // parse callbacks run back-to-back, starving the event loop for seconds.
    await Bun.sleep(0)
    const lines = text.split('\n')

    const fileDiffs: Array<{ file: string; additions: number; deletions: number }> = []

    for (const line of lines) {
      if (!line) continue
      // Quick filter: only parse lines that might be toolResult messages with edit/write
      if (!line.includes('"toolResult"')) continue
      if (!line.includes('"edit"') && !line.includes('"write"')) continue

      let parsed: any
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }

      // Pi JSONL format: { type: "message", message: { role: "toolResult", ... } }
      if (parsed?.type !== 'message') continue
      const message = parsed?.message
      if (!message || message.role !== 'toolResult') continue

      const toolName = message.toolName as string | undefined
      if (!toolName) continue

      // Edit tool: has details.diff (unified diff string)
      if (toolName === 'edit') {
        const details = message.details
        if (!details || typeof details !== 'object') continue
        const diff = typeof details.diff === 'string' ? details.diff : ''
        if (!diff) continue

        // Extract file path from the tool call arguments
        // The toolResult message has toolCallId but not the file path directly.
        // However, the edit details often include the file info in the diff header.
        // Parse from diff header: "--- a/path" or from content
        let file = ''
        const headerMatch = diff.match(/^[-+]{3} [ab]\/(.+)$/m)
        if (headerMatch) {
          file = headerMatch[1]
        }
        // If no header, try to extract from surrounding context
        if (!file) {
          // Look for file reference in the content array
          const content = Array.isArray(message.content) ? message.content : []
          for (const c of content) {
            if (c?.type === 'text' && typeof c.text === 'string') {
              const pathMatch = c.text.match(/(?:edited|modified|updated)\s+(.+)/i)
              if (pathMatch) {
                file = pathMatch[1].trim()
                break
              }
            }
          }
        }
        if (!file) file = 'unknown'

        const stats = countUnifiedDiffStats(diff)
        if (stats.additions > 0 || stats.deletions > 0) {
          fileDiffs.push({ file, additions: stats.additions, deletions: stats.deletions })
        }
        continue
      }

      // Write tool: creates a new file (count lines as additions)
      if (toolName === 'write') {
        // Write tool result typically has content describing what was written
        // We can extract the file path from tool arguments in the content
        const content = Array.isArray(message.content) ? message.content : []
        let file = ''
        let lineCount = 0

        for (const c of content) {
          if (c?.type === 'text' && typeof c.text === 'string') {
            const pathMatch = c.text.match(/(?:wrote|created|write)\s+(.+)/i)
            if (pathMatch) {
              file = pathMatch[1].trim()
            }
            // Count lines in the written content as a rough additions estimate
            if (!lineCount) {
              lineCount = c.text.split('\n').length
            }
          }
        }

        if (!file) file = 'unknown'
        // For write tool, we don't have precise line counts from the result.
        // The actual file content is in the preceding assistant toolCall args.
        // Just count it as 1 file touched (additions=0 is better than guessing).
        fileDiffs.push({ file, additions: lineCount > 0 ? lineCount : 0, deletions: 0 })
      }
    }

    const summary = aggregateFileDiffs(fileDiffs)
    statsCache.set(filePath, { mtime, summary })
    return summary
  } catch {
    return null
  }
}

/** Clear the stats cache. */
export function clearPiStatsCache(sessionPath?: string): void {
  if (sessionPath) {
    statsCache.delete(sessionPath)
  } else {
    statsCache.clear()
  }
}
