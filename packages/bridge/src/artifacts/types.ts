export type ArtifactBackend = 'opencode' | 'claude-code'

export type ArtifactTool = 'Write' | 'Edit' | 'MultiEdit' | 'Patch' | 'NotebookEdit'

export type ArtifactOperation = 'create' | 'edit'

export type ArtifactFileType = 'code' | 'config' | 'docs' | 'data' | 'script' | 'other'

export type Artifact = {
  id: string
  backend: ArtifactBackend
  sessionId: string
  messageId?: string | null
  toolUseId: string
  projectPath: string
  gitBranch?: string | null

  tool: ArtifactTool
  operation: ArtifactOperation
  toolInput: Record<string, unknown>
  toolOutput?: string | null

  filePath: string
  filename: string
  directory: string
  extension: string
  language: string
  fileType: ArtifactFileType

  contentBefore?: string | null
  contentAfter?: string | null
  unifiedDiff?: string | null

  additions: number
  deletions: number
  linesChanged: number
  sizeBytes: number

  createdAt: number

  summary?: string | null
  smartTags?: string[] | null

  userTags?: string[] | null
  starred: boolean
  notes?: string | null
}

export type ArtifactSummary = {
  id: string
  backend: ArtifactBackend
  sessionId: string
  messageId?: string | null
  toolUseId: string
  projectPath: string
  gitBranch?: string | null

  tool: ArtifactTool
  operation: ArtifactOperation

  filePath: string
  filename: string
  directory: string
  extension: string
  language: string
  fileType: ArtifactFileType

  additions: number
  deletions: number
  linesChanged: number
  sizeBytes: number

  createdAt: number

  summary?: string | null
  smartTags?: string[] | null

  userTags?: string[] | null
  starred: boolean
  notes?: string | null
}

export type ArtifactSearchFilters = {
  backend?: ArtifactBackend
  projectPath?: string
  language?: string
  fileType?: ArtifactFileType
  starred?: boolean
}

export type ArtifactSearchQuery = {
  text?: string
  filters?: ArtifactSearchFilters
  limit?: number
  offset?: number
}

export type ArtifactSearchResult = {
  artifacts: ArtifactSummary[]
  total: number
  query: ArtifactSearchQuery
}

export type ArtifactEnrichmentProvider = 'off' | 'claude-code' | 'opencode'

export type ArtifactEnrichmentConfig = {
  provider: ArtifactEnrichmentProvider
  enabled: boolean
  batchSize: number
  maxCharsPerArtifact: number
  hiddenCwd: string
}

export type ArtifactsConfig = {
  indexingEnabled: boolean
  maxContentChars: number
  enrichment: ArtifactEnrichmentConfig
}

export type ArtifactsStats = {
  dbPath: string
  dbSizeBytes: number
  totalArtifacts: number
  starredArtifacts: number
  backends: Record<ArtifactBackend, number>
  updatedAt: number
}

export type ArtifactIndexEvent = {
  backend: ArtifactBackend
  sessionId: string
  messageId?: string | null
  toolUseId: string
  projectPath: string
  gitBranch?: string | null

  tool: string
  toolInput?: Record<string, unknown>
  toolOutput?: string | null

  filePath?: string | null
  contentBefore?: string | null
  contentAfter?: string | null
  structuredPatch?: unknown
  unifiedDiff?: string | null

  timestamp?: number
}
