import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'

type MigrationResult = {
  hasFts: boolean
}

const ARTIFACTS_DB_PATH = join(homedir(), '.broski', 'artifacts.db')

let db: Database | null = null
let migration: MigrationResult | null = null

export function getArtifactsDbPath(): string {
  return ARTIFACTS_DB_PATH
}

export function getArtifactsDb(): { db: Database; hasFts: boolean } {
  if (!db) {
    console.log('[Artifacts] Opening database at:', ARTIFACTS_DB_PATH)
    mkdirSync(dirname(ARTIFACTS_DB_PATH), { recursive: true })
    db = new Database(ARTIFACTS_DB_PATH)
    migration = migrate(db)
    console.log('[Artifacts] Database opened, hasFts:', migration?.hasFts)
  }
  return { db, hasFts: migration?.hasFts ?? false }
}

export function closeArtifactsDb(): void {
  try {
    db?.close()
  } catch {
    // ignore
  }
  db = null
  migration = null
}

function ensureColumns(database: Database): void {
  const info = database
    .prepare(`PRAGMA table_info(artifacts);`)
    .all() as Array<{ name?: string }>
  const existing = new Set(info.map((r) => String(r.name ?? '')))

  const addColumn = (name: string, type: string) => {
    if (existing.has(name)) return
    database.exec(`ALTER TABLE artifacts ADD COLUMN ${name} ${type};`)
    existing.add(name)
  }

  addColumn('enrichedAt', 'INTEGER')
  addColumn('enrichmentModel', 'TEXT')
}

function migrate(database: Database): MigrationResult {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS artifacts (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,

      id TEXT NOT NULL UNIQUE,
      backend TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      messageId TEXT,
      toolUseId TEXT NOT NULL,
      projectPath TEXT NOT NULL,
      gitBranch TEXT,

      tool TEXT NOT NULL,
      operation TEXT NOT NULL,
      toolInputJson TEXT NOT NULL,
      toolOutput TEXT,

      filePath TEXT NOT NULL,
      filename TEXT NOT NULL,
      directory TEXT NOT NULL,
      extension TEXT NOT NULL,
      language TEXT NOT NULL,
      fileType TEXT NOT NULL,

      contentBefore TEXT,
      contentAfter TEXT,
      unifiedDiff TEXT,

      additions INTEGER NOT NULL,
      deletions INTEGER NOT NULL,
      linesChanged INTEGER NOT NULL,
      sizeBytes INTEGER NOT NULL,

      createdAt INTEGER NOT NULL,

      summary TEXT,
      smartTagsJson TEXT,
      smartTagsText TEXT,

      userTagsJson TEXT,
      userTagsText TEXT,
      starred INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      enrichedAt INTEGER,
      enrichmentModel TEXT,

      UNIQUE(backend, sessionId, toolUseId)
    );

    CREATE INDEX IF NOT EXISTS idx_artifacts_createdAt ON artifacts(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_project_createdAt ON artifacts(projectPath, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_backend_createdAt ON artifacts(backend, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_filePath ON artifacts(filePath);
    CREATE INDEX IF NOT EXISTS idx_artifacts_starred_createdAt ON artifacts(starred, createdAt DESC);
  `)

  // For existing DBs created before new columns existed
  ensureColumns(database)

  let hasFts = true
  try {
    console.log('[Artifacts] Creating FTS5 virtual table...')
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
        filePath,
        filename,
        directory,
        projectPath,
        tool,
        operation,
        language,
        fileType,
        summary,
        smartTagsText,
        userTagsText,
        notes,
        contentAfter,
        content='artifacts',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS artifacts_ai AFTER INSERT ON artifacts BEGIN
        INSERT INTO artifacts_fts(rowid, filePath, filename, directory, projectPath, tool, operation, language, fileType, summary, smartTagsText, userTagsText, notes, contentAfter)
        VALUES (new.rowid, new.filePath, new.filename, new.directory, new.projectPath, new.tool, new.operation, new.language, new.fileType, new.summary, new.smartTagsText, new.userTagsText, new.notes, new.contentAfter);
      END;

      CREATE TRIGGER IF NOT EXISTS artifacts_ad AFTER DELETE ON artifacts BEGIN
        INSERT INTO artifacts_fts(artifacts_fts, rowid, filePath, filename, directory, projectPath, tool, operation, language, fileType, summary, smartTagsText, userTagsText, notes, contentAfter)
        VALUES ('delete', old.rowid, old.filePath, old.filename, old.directory, old.projectPath, old.tool, old.operation, old.language, old.fileType, old.summary, old.smartTagsText, old.userTagsText, old.notes, old.contentAfter);
      END;

      CREATE TRIGGER IF NOT EXISTS artifacts_au AFTER UPDATE ON artifacts BEGIN
        INSERT INTO artifacts_fts(artifacts_fts, rowid, filePath, filename, directory, projectPath, tool, operation, language, fileType, summary, smartTagsText, userTagsText, notes, contentAfter)
        VALUES ('delete', old.rowid, old.filePath, old.filename, old.directory, old.projectPath, old.tool, old.operation, old.language, old.fileType, old.summary, old.smartTagsText, old.userTagsText, old.notes, old.contentAfter);
        INSERT INTO artifacts_fts(rowid, filePath, filename, directory, projectPath, tool, operation, language, fileType, summary, smartTagsText, userTagsText, notes, contentAfter)
        VALUES (new.rowid, new.filePath, new.filename, new.directory, new.projectPath, new.tool, new.operation, new.language, new.fileType, new.summary, new.smartTagsText, new.userTagsText, new.notes, new.contentAfter);
      END;
    `)
    console.log('[Artifacts] FTS5 virtual table created successfully')
  } catch (err) {
    hasFts = false
    // If FTS5 isn't available, we still keep the main table working.
    console.warn('[Artifacts] FTS5 unavailable; falling back to basic LIKE search:', err)
  }

  return { hasFts }
}
