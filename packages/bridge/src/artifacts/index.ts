import { createHash } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import { getArtifactsDb } from './db'
import type {
  Artifact,
  ArtifactBackend,
  ArtifactFileType,
  ArtifactIndexEvent,
  ArtifactOperation,
  ArtifactSearchQuery,
  ArtifactSearchResult,
  ArtifactSummary,
  ArtifactsConfig,
  ArtifactEnrichmentConfig,
  ArtifactTool,
} from './types'

const DEBUG_ARTIFACTS = process.env.BROSKI_DEBUG_ARTIFACTS === '1'

function clampIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim().length === 0) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

function clampText(value: string | null | undefined, maxChars: number): string | null {
  if (typeof value !== 'string') return null
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n…(truncated)…`
}

function clampQueueText(value: unknown, maxChars: number): string | null {
  if (maxChars <= 0) return null
  if (typeof value !== 'string') return null
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars)
}

function stableArtifactKey(backend: ArtifactBackend, sessionId: string, toolUseId: string): string {
  return `${backend}:${sessionId}:${toolUseId}`
}

function estimateEventSizeChars(event: ArtifactIndexEvent): number {
  let n = 0
  // Most risk comes from large string payloads; we track those.
  if (typeof event.filePath === 'string') n += event.filePath.length
  if (typeof event.contentBefore === 'string') n += event.contentBefore.length
  if (typeof event.contentAfter === 'string') n += event.contentAfter.length
  if (typeof event.unifiedDiff === 'string') n += event.unifiedDiff.length
  if (typeof event.toolOutput === 'string') n += event.toolOutput.length
  // Tool input is typically small metadata; count a small constant to avoid expensive sizing.
  if (event.toolInput && typeof event.toolInput === 'object') n += 256
  return n
}

function normalizeEventForQueue(
  event: ArtifactIndexEvent,
  pressure: 'normal' | 'high' | 'critical',
): ArtifactIndexEvent {
  const caps =
    pressure === 'critical'
      ? { contentAfter: 0, contentBefore: 0, unifiedDiff: 5_000, toolOutput: 0 }
      : pressure === 'high'
        ? { contentAfter: 10_000, contentBefore: 5_000, unifiedDiff: 20_000, toolOutput: 5_000 }
        : { contentAfter: 50_000, contentBefore: 20_000, unifiedDiff: 80_000, toolOutput: 20_000 }

  return {
    ...event,
    // Under pressure, drop non-essential tool input to keep memory bounded.
    toolInput: pressure === 'critical' ? {} : (event.toolInput ?? {}),
    contentAfter: clampQueueText(event.contentAfter, caps.contentAfter),
    contentBefore: clampQueueText(event.contentBefore, caps.contentBefore),
    unifiedDiff: clampQueueText(event.unifiedDiff, caps.unifiedDiff),
    toolOutput: clampQueueText(event.toolOutput, caps.toolOutput),
  }
}

function mergeArtifactEvents(prev: ArtifactIndexEvent, next: ArtifactIndexEvent): ArtifactIndexEvent {
  const pickString = (a: unknown, b: unknown): string | null => {
    const as = typeof a === 'string' && a.trim().length > 0 ? a : null
    const bs = typeof b === 'string' && b.trim().length > 0 ? b : null
    return bs ?? as
  }

  const pickLonger = (a: unknown, b: unknown): string | null => {
    const as = typeof a === 'string' && a.length > 0 ? a : null
    const bs = typeof b === 'string' && b.length > 0 ? b : null
    if (!as) return bs
    if (!bs) return as
    return bs.length >= as.length ? bs : as
  }

  const mergedToolInput =
    next.toolInput && Object.keys(next.toolInput).length > 0
      ? next.toolInput
      : (prev.toolInput ?? {})

  return {
    ...prev,
    ...next,
    messageId: next.messageId ?? prev.messageId ?? null,
    gitBranch: next.gitBranch ?? prev.gitBranch ?? null,
    filePath: pickString(prev.filePath, next.filePath),
    tool: pickString(prev.tool, next.tool) ?? '',
    toolInput: mergedToolInput,
    toolOutput: pickLonger(prev.toolOutput, next.toolOutput),
    contentBefore: pickLonger(prev.contentBefore, next.contentBefore),
    contentAfter: pickLonger(prev.contentAfter, next.contentAfter),
    unifiedDiff: pickLonger(prev.unifiedDiff, next.unifiedDiff),
    timestamp: (() => {
      const a = Number(prev.timestamp ?? 0)
      const b = Number(next.timestamp ?? 0)
      const t = Math.max(a, b)
      return t > 0 ? t : (next.timestamp ?? prev.timestamp)
    })(),
  }
}

function joinText(values: string[] | null | undefined): { json: string | null; text: string | null } {
  if (!values || values.length === 0) return { json: null, text: null }
  const cleaned = values
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0)
    .slice(0, 64)
  if (cleaned.length === 0) return { json: null, text: null }
  return { json: JSON.stringify(cleaned), text: cleaned.join(' ') }
}

function languageFromExtension(ext: string): string {
  const e = ext.toLowerCase()
  switch (e) {
    case '.ts':
    case '.tsx':
      return 'typescript'
    case '.js':
    case '.jsx':
      return 'javascript'
    case '.dart':
      return 'dart'
    case '.py':
      return 'python'
    case '.go':
      return 'go'
    case '.rs':
      return 'rust'
    case '.java':
      return 'java'
    case '.kt':
      return 'kotlin'
    case '.swift':
      return 'swift'
    case '.c':
    case '.h':
      return 'c'
    case '.cc':
    case '.cpp':
    case '.hpp':
      return 'cpp'
    case '.json':
      return 'json'
    case '.yaml':
    case '.yml':
      return 'yaml'
    case '.md':
      return 'markdown'
    case '.sh':
      return 'bash'
    default:
      return 'text'
  }
}

function fileTypeFromPath(filePath: string): ArtifactFileType {
  const p = filePath.toLowerCase()
  const ext = extname(p)
  if (p.endsWith('readme.md') || ext === '.md' || ext === '.txt' || ext === '.rst') return 'docs'
  if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.toml' || ext === '.ini' || ext === '.env') return 'config'
  if (ext === '.sql' || ext === '.csv') return 'data'
  if (ext === '.sh') return 'script'
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.pdf') return 'data'
  if (ext.length > 0) return 'code'
  return 'other'
}

function ensureAbsolutePath(projectPath: string, filePath: string): string {
  if (isAbsolute(filePath)) return filePath
  return resolve(projectPath, filePath)
}

function safeJsonParseArray(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch {
    return null
  }
}

function safeJsonParseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function countDiffAddDel(diffText: string | null): { additions: number; deletions: number } {
  if (!diffText) return { additions: 0, deletions: 0 }
  let additions = 0
  let deletions = 0
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions++
    if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

async function readFileIfExists(absolutePath: string): Promise<string | null> {
  try {
    const f = Bun.file(absolutePath)
    const exists = await f.exists()
    if (!exists) return null
    const text = await f.text()
    return text
  } catch {
    return null
  }
}

function normalizeToolName(tool: string): ArtifactTool | null {
  const t = String(tool || '').trim().toLowerCase()
  // Normalize to capitalized form for storage
  if (t === 'write') return 'Write'
  if (t === 'edit') return 'Edit'
  if (t === 'multiedit') return 'MultiEdit'
  if (t === 'patch') return 'Patch'
  if (t === 'notebookedit') return 'NotebookEdit'
  return null
}

function inferOperation(contentBefore: string | null, contentAfter: string | null): ArtifactOperation {
  if (!contentBefore || contentBefore.length === 0) return 'create'
  if (!contentAfter || contentAfter.length === 0) return 'edit'
  return 'edit'
}

type SqlRow = Record<string, unknown>

function rowToArtifact(row: SqlRow): Artifact {
  return {
    id: String(row.id),
    backend: row.backend as ArtifactBackend,
    sessionId: String(row.sessionId),
    messageId: row.messageId != null ? String(row.messageId) : null,
    toolUseId: String(row.toolUseId),
    projectPath: String(row.projectPath),
    gitBranch: row.gitBranch != null ? String(row.gitBranch) : null,

    tool: row.tool as ArtifactTool,
    operation: row.operation as ArtifactOperation,
    toolInput: safeJsonParseObject(row.toolInputJson),
    toolOutput: row.toolOutput != null ? String(row.toolOutput) : null,

    filePath: String(row.filePath),
    filename: String(row.filename),
    directory: String(row.directory),
    extension: String(row.extension),
    language: String(row.language),
    fileType: row.fileType as ArtifactFileType,

    contentBefore: row.contentBefore != null ? String(row.contentBefore) : null,
    contentAfter: row.contentAfter != null ? String(row.contentAfter) : null,
    unifiedDiff: row.unifiedDiff != null ? String(row.unifiedDiff) : null,

    additions: Number(row.additions ?? 0),
    deletions: Number(row.deletions ?? 0),
    linesChanged: Number(row.linesChanged ?? 0),
    sizeBytes: Number(row.sizeBytes ?? 0),

    createdAt: Number(row.createdAt ?? 0),

    summary: row.summary != null ? String(row.summary) : null,
    smartTags: safeJsonParseArray(row.smartTagsJson),

    userTags: safeJsonParseArray(row.userTagsJson),
    starred: Number(row.starred ?? 0) > 0,
    notes: row.notes != null ? String(row.notes) : null,
  }
}

function rowToArtifactSummary(row: SqlRow): ArtifactSummary {
  return {
    id: String(row.id),
    backend: row.backend as ArtifactBackend,
    sessionId: String(row.sessionId),
    messageId: row.messageId != null ? String(row.messageId) : null,
    toolUseId: String(row.toolUseId),
    projectPath: String(row.projectPath),
    gitBranch: row.gitBranch != null ? String(row.gitBranch) : null,

    tool: row.tool as ArtifactTool,
    operation: row.operation as ArtifactOperation,

    filePath: String(row.filePath),
    filename: String(row.filename),
    directory: String(row.directory),
    extension: String(row.extension),
    language: String(row.language),
    fileType: row.fileType as ArtifactFileType,

    additions: Number(row.additions ?? 0),
    deletions: Number(row.deletions ?? 0),
    linesChanged: Number(row.linesChanged ?? 0),
    sizeBytes: Number(row.sizeBytes ?? 0),

    createdAt: Number(row.createdAt ?? 0),

    summary: row.summary != null ? String(row.summary) : null,
    smartTags: safeJsonParseArray(row.smartTagsJson),

    userTags: safeJsonParseArray(row.userTagsJson),
    starred: Number(row.starred ?? 0) > 0,
    notes: row.notes != null ? String(row.notes) : null,
  }
}

export class ArtifactIndex {
  // Option A: bounded, coalescing in-memory queue (never unbounded RAM growth).
  // We coalesce by stable artifact identity (backend+sessionId+toolUseId).
  // We keep an LRU-like order list using (key, version) tokens so updates are O(1).
  private pendingByKey = new Map<string, { event: ArtifactIndexEvent; sizeChars: number; v: number }>()
  private order: Array<{ k: string; v: number }> = []
  private processHead = 0
  private evictHead = 0
  private pendingChars = 0
  private seq = 0
  private evictedKeys = 0
  private coalescedUpdates = 0
  private processing = false
  private enabled = true
  private maxContentChars = 250_000
  private enrichment: ArtifactEnrichmentConfig = {
    provider: 'off',
    followSelectedAgent: true,
    enabled: false,
    batchSize: 5,
    maxCharsPerArtifact: 6000,
    hiddenCwd: '/tmp/broski-enrichment',
  }
  private maxPendingKeys = clampIntEnv('BROSKI_ARTIFACT_QUEUE_MAX_KEYS', 1000, 50, 50_000)
  private maxPendingChars = clampIntEnv('BROSKI_ARTIFACT_QUEUE_MAX_CHARS', 12_000_000, 200_000, 200_000_000)

  applyConfig(config: ArtifactsConfig): void {
    this.enabled = config.indexingEnabled
    this.maxContentChars = config.maxContentChars
    this.enrichment = config.enrichment
  }

  enqueue(event: ArtifactIndexEvent): void {
    if (!this.enabled) return
    // Avoid indexing our own hidden enrichment workspaces to prevent pollution.
    if (event.projectPath && this.enrichment.hiddenCwd && event.projectPath.startsWith(this.enrichment.hiddenCwd)) {
      return
    }

    const key = stableArtifactKey(event.backend, event.sessionId, event.toolUseId)
    const pressure = this.queuePressure()
    const normalized = normalizeEventForQueue(event, pressure)

    const existing = this.pendingByKey.get(key)
    if (existing) {
      const merged = mergeArtifactEvents(existing.event, normalized)
      const nextSize = estimateEventSizeChars(merged)
      this.pendingChars += nextSize - existing.sizeChars
      existing.event = merged
      existing.sizeChars = nextSize
      existing.v = ++this.seq
      this.order.push({ k: key, v: existing.v })
      this.coalescedUpdates++
    } else {
      const next = {
        event: normalized,
        sizeChars: estimateEventSizeChars(normalized),
        v: ++this.seq,
      }
      this.pendingByKey.set(key, next)
      this.pendingChars += next.sizeChars
      this.order.push({ k: key, v: next.v })
    }

    this.evictIfNeeded()
    this.kick()
  }

  private kick(): void {
    if (this.processing) return
    this.processing = true
    setTimeout(() => void this.processLoop(), 0)
  }

  private async processLoop(): Promise<void> {
    for (;;) {
      const next = this.dequeueNext()
      if (!next) break
      try {
        await this.indexEvent(next)
      } catch (err) {
        console.warn('[Artifacts] Failed to index event:', err)
      }
    }
    this.processing = false
    if (this.pendingByKey.size > 0) this.kick()
  }

  private dequeueNext(): ArtifactIndexEvent | null {
    for (;;) {
      if (this.processHead >= this.order.length) {
        this.compactOrderIfNeeded()
        return null
      }
      const token = this.order[this.processHead++]
      const entry = this.pendingByKey.get(token.k)
      if (!entry) continue
      if (entry.v !== token.v) continue

      this.pendingByKey.delete(token.k)
      this.pendingChars -= entry.sizeChars
      this.compactOrderIfNeeded()
      return entry.event
    }
  }

  private compactOrderIfNeeded(): void {
    // Prevent the order list from growing forever due to version tokens.
    const minHead = Math.min(this.processHead, this.evictHead)
    if (minHead < 4096) return
    if (minHead < this.order.length / 2) return
    this.order = this.order.slice(minHead)
    this.processHead -= minHead
    this.evictHead -= minHead
  }

  private queuePressure(): 'normal' | 'high' | 'critical' {
    const keyRatio = this.maxPendingKeys > 0 ? this.pendingByKey.size / this.maxPendingKeys : 0
    const charRatio = this.maxPendingChars > 0 ? this.pendingChars / this.maxPendingChars : 0
    const r = Math.max(keyRatio, charRatio)
    if (r >= 0.9) return 'critical'
    if (r >= 0.7) return 'high'
    return 'normal'
  }

  private evictIfNeeded(): void {
    // Evict oldest (LRU-token order) until within bounds.
    while (this.pendingByKey.size > this.maxPendingKeys || this.pendingChars > this.maxPendingChars) {
      const evicted = this.evictOne()
      if (!evicted) break
    }
  }

  private evictOne(): boolean {
    for (;;) {
      if (this.evictHead >= this.order.length) {
        // Nothing left to evict.
        this.compactOrderIfNeeded()
        return false
      }
      const token = this.order[this.evictHead++]
      const entry = this.pendingByKey.get(token.k)
      if (!entry) continue
      if (entry.v !== token.v) continue
      this.pendingByKey.delete(token.k)
      this.pendingChars -= entry.sizeChars
      this.evictedKeys++
      this.compactOrderIfNeeded()
      return true
    }
  }

  private async indexEvent(event: ArtifactIndexEvent): Promise<void> {
    const tool = normalizeToolName(event.tool)
    if (!tool) return
    const filePathRaw = typeof event.filePath === 'string' ? event.filePath : ''
    if (!filePathRaw) return

    const createdAt = typeof event.timestamp === 'number' ? event.timestamp : Date.now()
    const filename = basename(filePathRaw)
    const directory = dirname(filePathRaw)
    const extension = extname(filename) || extname(filePathRaw) || ''
    const language = languageFromExtension(extension)
    const fileType = fileTypeFromPath(filePathRaw)

    let contentBefore = clampText(event.contentBefore ?? null, this.maxContentChars)
    let contentAfter = clampText(event.contentAfter ?? null, this.maxContentChars)
    let unifiedDiff = clampText(event.unifiedDiff ?? null, this.maxContentChars)

    // If we don't have the final content, try to read it from disk (best-effort).
    if (!contentAfter || contentAfter.trim().length === 0) {
      const absolute = ensureAbsolutePath(event.projectPath, filePathRaw)
      const disk = await readFileIfExists(absolute)
      contentAfter = clampText(disk, this.maxContentChars)
    }

    // If we don't have explicit diff stats but do have a diff, compute +/-.
    let additions = 0
    let deletions = 0
    if (unifiedDiff) {
      const counts = countDiffAddDel(unifiedDiff)
      additions = counts.additions
      deletions = counts.deletions
    }

    const sizeBytes = contentAfter ? Buffer.byteLength(contentAfter, 'utf8') : 0
    const linesChanged = additions + deletions
    const operation = inferOperation(contentBefore, contentAfter)

    const id = stableArtifactId(event.backend, event.sessionId, event.toolUseId)
    const toolInput = event.toolInput ?? {}
    const toolOutput = clampText(event.toolOutput ?? null, this.maxContentChars)

    const { db } = getArtifactsDb()

    // IMPORTANT: Bun's SQLite has bugs with named parameters ($name style).
    // Using positional parameters (?1, ?2, etc.) for reliability.
    const stmt = db.prepare(`
      INSERT INTO artifacts (
        id, backend, sessionId, messageId, toolUseId, projectPath, gitBranch,
        tool, operation, toolInputJson, toolOutput,
        filePath, filename, directory, extension, language, fileType,
        contentBefore, contentAfter, unifiedDiff,
        additions, deletions, linesChanged, sizeBytes, createdAt,
        summary, smartTagsJson, smartTagsText,
        userTagsJson, userTagsText, starred, notes
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7,
        ?8, ?9, ?10, ?11,
        ?12, ?13, ?14, ?15, ?16, ?17,
        ?18, ?19, ?20,
        ?21, ?22, ?23, ?24, ?25,
        NULL, NULL, NULL,
        NULL, NULL, 0, NULL
      )
      ON CONFLICT(backend, sessionId, toolUseId) DO UPDATE SET
        id = excluded.id,
        messageId = excluded.messageId,
        projectPath = excluded.projectPath,
        gitBranch = excluded.gitBranch,
        tool = excluded.tool,
        operation = excluded.operation,
        toolInputJson = excluded.toolInputJson,
        toolOutput = excluded.toolOutput,
        filePath = excluded.filePath,
        filename = excluded.filename,
        directory = excluded.directory,
        extension = excluded.extension,
        language = excluded.language,
        fileType = excluded.fileType,
        contentBefore = excluded.contentBefore,
        contentAfter = excluded.contentAfter,
        unifiedDiff = excluded.unifiedDiff,
        additions = excluded.additions,
        deletions = excluded.deletions,
        linesChanged = excluded.linesChanged,
        sizeBytes = excluded.sizeBytes,
        createdAt = excluded.createdAt;
    `)

    // Pass values as an array in the correct order for positional parameters
    const values = [
      id,                                    // ?1
      event.backend,                         // ?2
      event.sessionId,                       // ?3
      event.messageId ?? null,               // ?4
      event.toolUseId,                       // ?5
      event.projectPath,                     // ?6
      event.gitBranch ?? null,               // ?7
      tool,                                  // ?8
      operation,                             // ?9
      JSON.stringify(toolInput ?? {}),       // ?10
      toolOutput,                            // ?11
      filePathRaw,                           // ?12
      filename,                              // ?13
      directory,                             // ?14
      extension,                             // ?15
      language,                              // ?16
      fileType,                              // ?17
      contentBefore,                         // ?18
      contentAfter,                          // ?19
      unifiedDiff,                           // ?20
      additions,                             // ?21
      deletions,                             // ?22
      linesChanged,                          // ?23
      sizeBytes,                             // ?24
      createdAt,                             // ?25
    ]

    if (DEBUG_ARTIFACTS) {
      console.log('[Artifacts] Inserting artifact:', { id, filePath: filePathRaw, tool, sessionId: event.sessionId })
    }
    stmt.run(...values)
    if (DEBUG_ARTIFACTS) {
      console.log('[Artifacts] Successfully inserted artifact:', id)
    }
  }

  clearAll(): void {
    // Also clear any pending queue to avoid processing stale events after wipe.
    this.pendingByKey.clear()
    this.order = []
    this.processHead = 0
    this.evictHead = 0
    this.pendingChars = 0
    this.seq = 0
    this.evictedKeys = 0
    this.coalescedUpdates = 0

    const { db, hasFts } = getArtifactsDb()
    db.exec(`DELETE FROM artifacts;`)
    if (hasFts) {
      try {
        db.exec(`INSERT INTO artifacts_fts(artifacts_fts) VALUES('rebuild');`)
      } catch {
        // ignore
      }
    }
  }

  stats(): {
    total: number
    starred: number
    backends: Record<ArtifactBackend, number>
    queue: {
      pendingKeys: number
      pendingChars: number
      evictedKeys: number
      coalescedUpdates: number
      maxPendingKeys: number
      maxPendingChars: number
    }
  } {
    const { db } = getArtifactsDb()
    const totalRow = db.prepare(`SELECT COUNT(*) as c FROM artifacts;`).get() as SqlRow
    const starredRow = db.prepare(`SELECT COUNT(*) as c FROM artifacts WHERE starred = 1;`).get() as SqlRow
    const backendRows = db.prepare(`SELECT backend, COUNT(*) as c FROM artifacts GROUP BY backend;`).all() as Array<{ backend?: string; c?: number }>
    const backends: Record<ArtifactBackend, number> = { opencode: 0, 'claude-code': 0 }
    for (const r of backendRows) {
      const b = String(r.backend ?? '')
      if (b === 'opencode' || b === 'claude-code') {
        backends[b] = Number(r.c ?? 0)
      }
    }
    return {
      total: Number(totalRow?.c ?? 0),
      starred: Number(starredRow?.c ?? 0),
      backends,
      queue: {
        pendingKeys: this.pendingByKey.size,
        pendingChars: this.pendingChars,
        evictedKeys: this.evictedKeys,
        coalescedUpdates: this.coalescedUpdates,
        maxPendingKeys: this.maxPendingKeys,
        maxPendingChars: this.maxPendingChars,
      },
    }
  }

  search(query: ArtifactSearchQuery): ArtifactSearchResult {
    const { db, hasFts } = getArtifactsDb()
    const text = String(query.text ?? '').trim()
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200)
    const offset = Math.max(Number(query.offset ?? 0), 0)
    const filters = query.filters ?? {}

    if (DEBUG_ARTIFACTS) {
      console.log('[Artifacts] search called with:', { text, limit, offset, filters, hasFts })
    }

    // NOTE: Bun's SQLite has bugs with named parameters ($name) for LIMIT/OFFSET and FTS5 MATCH.
    // We use indexed positional parameters (?N) throughout for reliability.
    // Structure: ?1 = searchQuery (FTS) or first filter, subsequent filters, then limit, offset

    // Build filter conditions and collect values in order
    const whereConditions: string[] = []
    const filterValues: unknown[] = []
    let paramIndex = 1

    if (filters.backend) {
      whereConditions.push(`a.backend = ?${paramIndex++}`)
      filterValues.push(filters.backend)
    }
    if (filters.projectPath) {
      whereConditions.push(`a.projectPath = ?${paramIndex++}`)
      filterValues.push(filters.projectPath)
    }
    if (filters.language) {
      whereConditions.push(`a.language = ?${paramIndex++}`)
      filterValues.push(filters.language)
    }
    if (filters.fileType) {
      whereConditions.push(`a.fileType = ?${paramIndex++}`)
      filterValues.push(filters.fileType)
    }
    if (filters.starred != null) {
      whereConditions.push(`a.starred = ?${paramIndex++}`)
      filterValues.push(filters.starred ? 1 : 0)
    }

    const limitParamIdx = paramIndex++
    const offsetParamIdx = paramIndex++

    if (text.length === 0) {
      const whereSql = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : ''
      if (DEBUG_ARTIFACTS) {
        console.log('[Artifacts] No text search, using simple query:', { whereSql, filterValues })
      }

      try {
        const selectParams = [...filterValues, limit, offset]
        const rows = db
          .prepare(
            `
            SELECT
              a.id, a.backend, a.sessionId, a.messageId, a.toolUseId, a.projectPath, a.gitBranch,
              a.tool, a.operation,
              a.filePath, a.filename, a.directory, a.extension, a.language, a.fileType,
              a.additions, a.deletions, a.linesChanged, a.sizeBytes, a.createdAt,
              a.summary, a.smartTagsJson,
              a.userTagsJson, a.starred, a.notes
            FROM artifacts a
            ${whereSql}
            ORDER BY a.createdAt DESC
            LIMIT ?${limitParamIdx} OFFSET ?${offsetParamIdx};
          `,
          )
          .all(...selectParams) as SqlRow[]

        const totalRow = filterValues.length > 0
          ? db.prepare(`SELECT COUNT(*) as c FROM artifacts a ${whereSql};`).get(...filterValues) as SqlRow
          : db.prepare(`SELECT COUNT(*) as c FROM artifacts a;`).get() as SqlRow

        if (DEBUG_ARTIFACTS) {
          console.log('[Artifacts] Query returned', rows.length, 'rows, total:', totalRow?.c)
        }
        return {
          artifacts: rows.map(rowToArtifactSummary),
          total: Number(totalRow?.c ?? 0),
          query: { ...query, limit, offset, text },
        }
      } catch (err) {
        console.error('[Artifacts] Simple query failed:', err)
        throw err
      }
    }

    if (hasFts) {
      try {
        const searchQuery = text.replaceAll('\u0000', '')
        if (DEBUG_ARTIFACTS) {
          console.log('[Artifacts] FTS search with:', { searchQuery, filterValues })
        }

        // For FTS, parameter order is: ?1 = search query, then filters, then limit, offset
        // Build FTS-specific WHERE clause with adjusted indices
        let ftsParamIndex = 2 // Start after ?1 (search query)
        const ftsWhereConditions: string[] = []

        if (filters.backend) {
          ftsWhereConditions.push(`a.backend = ?${ftsParamIndex++}`)
        }
        if (filters.projectPath) {
          ftsWhereConditions.push(`a.projectPath = ?${ftsParamIndex++}`)
        }
        if (filters.language) {
          ftsWhereConditions.push(`a.language = ?${ftsParamIndex++}`)
        }
        if (filters.fileType) {
          ftsWhereConditions.push(`a.fileType = ?${ftsParamIndex++}`)
        }
        if (filters.starred != null) {
          ftsWhereConditions.push(`a.starred = ?${ftsParamIndex++}`)
        }

        const ftsLimitIdx = ftsParamIndex++
        const ftsOffsetIdx = ftsParamIndex++

        const ftsWhereSql = ftsWhereConditions.length ? `AND ${ftsWhereConditions.join(' AND ')}` : ''
        const ftsSelectParams = [searchQuery, ...filterValues, limit, offset]
        const ftsCountParams = [searchQuery, ...filterValues]

        if (DEBUG_ARTIFACTS) {
          console.log('[Artifacts] FTS query params:', { ftsWhereSql, ftsSelectParams, ftsCountParams })
        }

        const rows = db
          .prepare(
            `
            SELECT
              a.id, a.backend, a.sessionId, a.messageId, a.toolUseId, a.projectPath, a.gitBranch,
              a.tool, a.operation,
              a.filePath, a.filename, a.directory, a.extension, a.language, a.fileType,
              a.additions, a.deletions, a.linesChanged, a.sizeBytes, a.createdAt,
              a.summary, a.smartTagsJson,
              a.userTagsJson, a.starred, a.notes
            FROM artifacts_fts f
            JOIN artifacts a ON a.rowid = f.rowid
            WHERE artifacts_fts MATCH ?1
            ${ftsWhereSql}
            ORDER BY bm25(artifacts_fts) ASC, a.createdAt DESC
            LIMIT ?${ftsLimitIdx} OFFSET ?${ftsOffsetIdx};
          `,
          )
          .all(...ftsSelectParams) as SqlRow[]

        // Build count query WHERE clause
        let countParamIndex = 2
        const countWhereConditions: string[] = []
        if (filters.backend) countWhereConditions.push(`a.backend = ?${countParamIndex++}`)
        if (filters.projectPath) countWhereConditions.push(`a.projectPath = ?${countParamIndex++}`)
        if (filters.language) countWhereConditions.push(`a.language = ?${countParamIndex++}`)
        if (filters.fileType) countWhereConditions.push(`a.fileType = ?${countParamIndex++}`)
        if (filters.starred != null) countWhereConditions.push(`a.starred = ?${countParamIndex++}`)
        const countWhereSql = countWhereConditions.length ? `AND ${countWhereConditions.join(' AND ')}` : ''

        const totalRow = db
          .prepare(
            `
            SELECT COUNT(*) as c
            FROM artifacts_fts f
            JOIN artifacts a ON a.rowid = f.rowid
            WHERE artifacts_fts MATCH ?1
            ${countWhereSql};
          `,
          )
          .get(...ftsCountParams) as SqlRow

        if (DEBUG_ARTIFACTS) {
          console.log('[Artifacts] FTS query returned', rows.length, 'rows, total:', totalRow?.c)
        }
        return {
          artifacts: rows.map(rowToArtifactSummary),
          total: Number(totalRow?.c ?? 0),
          query: { ...query, limit, offset, text },
        }
      } catch (err) {
        console.warn('[Artifacts] FTS query failed; falling back to LIKE search:', err)
      }
    }

    // Fallback: basic LIKE search when FTS is unavailable.
    const likePattern = `%${text}%`
    if (DEBUG_ARTIFACTS) {
      console.log('[Artifacts] LIKE search with:', { likePattern, filterValues })
    }

    // For LIKE, parameter order is: ?1 = like pattern (used 5 times for OR), then filters, then limit, offset
    // We use the same ?1 parameter for all LIKE comparisons
    let likeParamIndex = 2
    const likeWhereConditions: string[] = []

    if (filters.backend) {
      likeWhereConditions.push(`a.backend = ?${likeParamIndex++}`)
    }
    if (filters.projectPath) {
      likeWhereConditions.push(`a.projectPath = ?${likeParamIndex++}`)
    }
    if (filters.language) {
      likeWhereConditions.push(`a.language = ?${likeParamIndex++}`)
    }
    if (filters.fileType) {
      likeWhereConditions.push(`a.fileType = ?${likeParamIndex++}`)
    }
    if (filters.starred != null) {
      likeWhereConditions.push(`a.starred = ?${likeParamIndex++}`)
    }

    const likeLimitIdx = likeParamIndex++
    const likeOffsetIdx = likeParamIndex++
    const likeWhereSql = likeWhereConditions.length ? `AND ${likeWhereConditions.join(' AND ')}` : ''

    const likeSelectParams = [likePattern, ...filterValues, limit, offset]
    const likeCountParams = [likePattern, ...filterValues]

    try {
      const rows = db
        .prepare(
          `
          SELECT
            a.id, a.backend, a.sessionId, a.messageId, a.toolUseId, a.projectPath, a.gitBranch,
            a.tool, a.operation,
            a.filePath, a.filename, a.directory, a.extension, a.language, a.fileType,
            a.additions, a.deletions, a.linesChanged, a.sizeBytes, a.createdAt,
            a.summary, a.smartTagsJson,
            a.userTagsJson, a.starred, a.notes
          FROM artifacts a
          WHERE (a.filePath LIKE ?1 OR a.summary LIKE ?1 OR a.smartTagsText LIKE ?1 OR a.userTagsText LIKE ?1 OR a.notes LIKE ?1)
          ${likeWhereSql}
          ORDER BY a.createdAt DESC
          LIMIT ?${likeLimitIdx} OFFSET ?${likeOffsetIdx};
        `,
        )
        .all(...likeSelectParams) as SqlRow[]

      // Build count WHERE clause
      let countParamIndex = 2
      const countWhereConditions: string[] = []
      if (filters.backend) countWhereConditions.push(`a.backend = ?${countParamIndex++}`)
      if (filters.projectPath) countWhereConditions.push(`a.projectPath = ?${countParamIndex++}`)
      if (filters.language) countWhereConditions.push(`a.language = ?${countParamIndex++}`)
      if (filters.fileType) countWhereConditions.push(`a.fileType = ?${countParamIndex++}`)
      if (filters.starred != null) countWhereConditions.push(`a.starred = ?${countParamIndex++}`)
      const countWhereSql = countWhereConditions.length ? `AND ${countWhereConditions.join(' AND ')}` : ''

      const totalRow = db
        .prepare(
          `
          SELECT COUNT(*) as c
          FROM artifacts a
          WHERE (a.filePath LIKE ?1 OR a.summary LIKE ?1 OR a.smartTagsText LIKE ?1 OR a.userTagsText LIKE ?1 OR a.notes LIKE ?1)
          ${countWhereSql};
        `,
        )
        .get(...likeCountParams) as SqlRow

      if (DEBUG_ARTIFACTS) {
        console.log('[Artifacts] LIKE query returned', rows.length, 'rows, total:', totalRow?.c)
      }
      return {
        artifacts: rows.map(rowToArtifactSummary),
        total: Number(totalRow?.c ?? 0),
        query: { ...query, limit, offset, text },
      }
    } catch (err) {
      console.error('[Artifacts] LIKE query failed:', err)
      throw err
    }
  }

  get(id: string): Artifact | null {
    const { db } = getArtifactsDb()
    // Use positional params for Bun SQLite compatibility
    const row = db
      .prepare(`SELECT * FROM artifacts WHERE id = ?1 LIMIT 1;`)
      .get(id) as SqlRow | null
    if (!row) return null
    return rowToArtifact(row)
  }

  updateUserFields(id: string, patch: { userTags?: string[] | null; starred?: boolean; notes?: string | null }): boolean {
    const { db } = getArtifactsDb()
    // Use positional params for Bun SQLite compatibility
    const existing = db
      .prepare(`SELECT userTagsJson, starred, notes FROM artifacts WHERE id = ?1 LIMIT 1;`)
      .get(id) as SqlRow | null
    if (!existing) return false

    const nextTags = patch.userTags != null ? patch.userTags : safeJsonParseArray(existing.userTagsJson) ?? []
    const tags = joinText(nextTags)

    const starred = patch.starred != null ? (patch.starred ? 1 : 0) : Number(existing.starred ?? 0)
    const notes = patch.notes != null
      ? clampText(patch.notes, this.maxContentChars)
      : (existing.notes != null ? String(existing.notes) : null)

    db.prepare(
      `
      UPDATE artifacts
      SET userTagsJson = ?1,
          userTagsText = ?2,
          starred = ?3,
          notes = ?4
      WHERE id = ?5;
    `,
    ).run(tags.json, tags.text, starred, notes, id)
    return true
  }

  updateEnrichmentFields(
    id: string,
    patch: { summary?: string | null; smartTags?: string[] | null; enrichedAt?: number; enrichmentModel?: string | null },
  ): boolean {
    const { db } = getArtifactsDb()
    // Use positional params for Bun SQLite compatibility
    const existing = db
      .prepare(`SELECT id FROM artifacts WHERE id = ?1 LIMIT 1;`)
      .get(id) as SqlRow | null
    if (!existing) return false

    const summary = patch.summary != null ? clampText(patch.summary, 1200) : null
    const tags = joinText(patch.smartTags ?? null)
    const enrichedAt = typeof patch.enrichedAt === 'number' ? Math.trunc(patch.enrichedAt) : Date.now()
    const enrichmentModel = patch.enrichmentModel != null ? String(patch.enrichmentModel) : null

    db.prepare(
      `
      UPDATE artifacts
      SET summary = ?1,
          smartTagsJson = ?2,
          smartTagsText = ?3,
          enrichedAt = ?4,
          enrichmentModel = ?5
      WHERE id = ?6;
    `,
    ).run(summary, tags.json, tags.text, enrichedAt, enrichmentModel, id)
    return true
  }
}

export const artifactIndex = new ArtifactIndex()

function stableArtifactId(backend: ArtifactBackend, sessionId: string, toolUseId: string): string {
  const h = createHash('sha256')
    .update(`${backend}:${sessionId}:${toolUseId}`)
    .digest('base64url')
  return `art_${h}`
}
