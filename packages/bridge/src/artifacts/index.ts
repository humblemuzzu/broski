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

function clampText(value: string | null | undefined, maxChars: number): string | null {
  if (typeof value !== 'string') return null
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n…(truncated)…`
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
  private queue: ArtifactIndexEvent[] = []
  private processing = false
  private enabled = true
  private maxContentChars = 250_000
  private enrichment: ArtifactEnrichmentConfig = {
    provider: 'off',
    enabled: false,
    batchSize: 5,
    maxCharsPerArtifact: 6000,
    hiddenCwd: '/tmp/broski-enrichment',
  }

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
    this.queue.push(event)
    this.kick()
  }

  private kick(): void {
    if (this.processing) return
    this.processing = true
    setTimeout(() => void this.processLoop(), 0)
  }

  private async processLoop(): Promise<void> {
    for (;;) {
      const next = this.queue.shift()
      if (!next) break
      try {
        await this.indexEvent(next)
      } catch (err) {
        console.warn('[Artifacts] Failed to index event:', err)
      }
    }
    this.processing = false
    if (this.queue.length > 0) this.kick()
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

    console.log('[Artifacts] Inserting artifact:', { id, filePath: filePathRaw, tool, sessionId: event.sessionId })
    stmt.run(...values)
    console.log('[Artifacts] Successfully inserted artifact:', id)
  }

  clearAll(): void {
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

  stats(): { total: number; starred: number; backends: Record<ArtifactBackend, number> } {
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
    }
  }

  search(query: ArtifactSearchQuery): ArtifactSearchResult {
    const { db, hasFts } = getArtifactsDb()
    const text = String(query.text ?? '').trim()
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200)
    const offset = Math.max(Number(query.offset ?? 0), 0)
    const filters = query.filters ?? {}

    console.log('[Artifacts] search called with:', { text, limit, offset, filters, hasFts })

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
      console.log('[Artifacts] No text search, using simple query:', { whereSql, filterValues })

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

        console.log('[Artifacts] Query returned', rows.length, 'rows, total:', totalRow?.c)
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
        console.log('[Artifacts] FTS search with:', { searchQuery, filterValues })

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

        console.log('[Artifacts] FTS query params:', { ftsWhereSql, ftsSelectParams, ftsCountParams })

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

        console.log('[Artifacts] FTS query returned', rows.length, 'rows, total:', totalRow?.c)
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
    console.log('[Artifacts] LIKE search with:', { likePattern, filterValues })

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

      console.log('[Artifacts] LIKE query returned', rows.length, 'rows, total:', totalRow?.c)
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
