import { mkdir } from 'node:fs/promises'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { OpenCodeConnector } from '../connectors/opencode'
import { getArtifactsDb } from './db'
import { getArtifactsConfig } from './config'
import { artifactIndex } from './index'

type Candidate = {
  id: string
  filePath: string
  language: string
  operation: string
  unifiedDiff: string | null
  contentAfter: string | null
}

type EnrichmentResult = {
  id: string
  summary: string
  tags: string[]
}

let opencode: OpenCodeConnector | null = null
let schedulerStarted = false
let runInFlight = false
let pendingKick = false

export function configureArtifactsEnrichment(deps: { opencodeConnector: OpenCodeConnector }): void {
  opencode = deps.opencodeConnector
  if (schedulerStarted) return
  schedulerStarted = true
  // Periodic best-effort enrichment (only runs when enabled).
  setInterval(() => void triggerArtifactsEnrichment(), 30_000)
}

export async function triggerArtifactsEnrichment(): Promise<boolean> {
  if (runInFlight) {
    pendingKick = true
    return false
  }

  const cfg = await getArtifactsConfig()
  if (!cfg.enrichment.enabled || cfg.enrichment.provider === 'off') return false

  runInFlight = true
  pendingKick = false
  try {
    await runOnce()
    return true
  } finally {
    runInFlight = false
    if (pendingKick) {
      pendingKick = false
      void triggerArtifactsEnrichment()
    }
  }
}

async function runOnce(): Promise<void> {
  const cfg = await getArtifactsConfig()
  if (!cfg.enrichment.enabled || cfg.enrichment.provider === 'off') return

  const batch = fetchCandidates(cfg.enrichment.batchSize)
  if (batch.length === 0) return

  await mkdir(cfg.enrichment.hiddenCwd, { recursive: true }).catch(() => {})

  let results: EnrichmentResult[] = []
  if (cfg.enrichment.provider === 'claude-code') {
    results = await enrichWithClaudeCode(batch, cfg.enrichment.maxCharsPerArtifact, cfg.enrichment.hiddenCwd)
  } else if (cfg.enrichment.provider === 'opencode') {
    results = await enrichWithOpenCode(batch, cfg.enrichment.maxCharsPerArtifact, cfg.enrichment.hiddenCwd)
  }

  const now = Date.now()
  const modelLabel =
    cfg.enrichment.provider === 'claude-code'
      ? 'claude-code'
      : cfg.enrichment.provider === 'opencode'
        ? 'opencode'
        : 'unknown'

  for (const item of results) {
    artifactIndex.updateEnrichmentFields(item.id, {
      summary: item.summary,
      smartTags: item.tags,
      enrichedAt: now,
      enrichmentModel: modelLabel,
    })
  }
}

function fetchCandidates(limit: number): Candidate[] {
  const { db } = getArtifactsDb()
  const rows = db
    .prepare(
      `
      SELECT id, filePath, language, operation, unifiedDiff, contentAfter
      FROM artifacts
      WHERE (summary IS NULL OR summary = '')
        AND (contentAfter IS NOT NULL AND length(contentAfter) > 0)
      ORDER BY createdAt DESC
      LIMIT $limit;
    `,
    )
    .all({ $limit: Math.min(Math.max(limit, 1), 20) }) as Array<Record<string, unknown>>

  return rows.map((r) => ({
    id: String(r.id),
    filePath: String(r.filePath),
    language: String(r.language),
    operation: String(r.operation),
    unifiedDiff: r.unifiedDiff != null ? String(r.unifiedDiff) : null,
    contentAfter: r.contentAfter != null ? String(r.contentAfter) : null,
  }))
}

function buildPrompt(items: Candidate[], maxCharsPerArtifact: number): string {
  const sb: string[] = []
  sb.push('You generate metadata for code artifacts.')
  sb.push('For each artifact below, produce:')
  sb.push('- a single-sentence summary (<= 160 chars)')
  sb.push('- 3 to 6 concise tags (lowercase, no spaces)')
  sb.push('Return ONLY valid JSON matching the provided schema.')
  sb.push('')

  let i = 0
  for (const item of items) {
    i++
    sb.push(`Artifact ${i}:`)
    sb.push(`id: ${item.id}`)
    sb.push(`filePath: ${item.filePath}`)
    sb.push(`language: ${item.language}`)
    sb.push(`operation: ${item.operation}`)
    const body = (item.unifiedDiff && item.unifiedDiff.trim().length > 0)
      ? item.unifiedDiff.trim()
      : (item.contentAfter ?? '').trim()
    const clipped = body.length > maxCharsPerArtifact ? `${body.slice(0, maxCharsPerArtifact)}\n…(truncated)…` : body
    sb.push('content:')
    sb.push('```')
    sb.push(clipped)
    sb.push('```')
    sb.push('')
  }
  return sb.join('\n')
}

async function enrichWithClaudeCode(items: Candidate[], maxCharsPerArtifact: number, hiddenCwd: string): Promise<EnrichmentResult[]> {
  const cc = await import('../connectors/claude-code')
  const available = await cc.checkClaudeCodeAvailable()
  if (!available) return []

  const cfg = cc.getConfig()
  const prompt = buildPrompt(items, maxCharsPerArtifact)

  const schema = {
    type: 'object',
    properties: {
      artifacts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            summary: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'summary', 'tags'],
          additionalProperties: false,
        },
      },
    },
    required: ['artifacts'],
    additionalProperties: false,
  }

  let structured: any = null
  let assistantText = ''

  const sdkOptions: any = {
    cwd: hiddenCwd,
    model: cfg.model || 'sonnet',
    allowedTools: [],
    disallowedTools: cfg.allowedTools ?? [],
    permissionMode: 'default',
    outputFormat: { type: 'json_schema', schema },
  }

  for await (const message of query({ prompt, ...sdkOptions })) {
    if (message?.type === 'assistant') {
      const content = message.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            assistantText += block.text
          }
        }
      }
    }
    if (message?.type === 'result') {
      structured = (message as any).structured_output ?? (message as any).structuredOutput ?? null
    }
  }

  const parsed = structured ?? tryParseJson(assistantText)
  const list = Array.isArray(parsed?.artifacts) ? parsed.artifacts : []

  const wanted = new Set(items.map((i) => i.id))
  const out: EnrichmentResult[] = []
  for (const entry of list) {
    const id = typeof entry?.id === 'string' ? entry.id : ''
    if (!wanted.has(id)) continue
    const summary = typeof entry?.summary === 'string' ? entry.summary.trim() : ''
    const tags = Array.isArray(entry?.tags) ? entry.tags.map(String).map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0).slice(0, 8) : []
    if (!summary) continue
    out.push({ id, summary, tags })
  }
  return out
}

async function enrichWithOpenCode(items: Candidate[], maxCharsPerArtifact: number, hiddenCwd: string): Promise<EnrichmentResult[]> {
  if (!opencode) return []
  const prompt = buildPrompt(items, maxCharsPerArtifact)

  const schemaHint = JSON.stringify(
    {
      artifacts: items.map((i) => ({ id: i.id, summary: '<string>', tags: ['<string>'] })),
    },
    null,
    2,
  )

  const fullPrompt = `${prompt}\nSchema example:\n${schemaHint}\n`

  // Create a temporary hidden session under /tmp to avoid showing up in real project lists.
  const session = await opencode.createSession(hiddenCwd, '_broski_enrichment_temp').catch(() => null)
  if (!session) return []

  const sessionId = session.id
  try {
    await opencode.sendPromptAsync(sessionId, fullPrompt, hiddenCwd).catch(() => null)

    const deadline = Date.now() + 90_000
    for (;;) {
      const statuses = await opencode.getSessionStatus(hiddenCwd)
      const status = statuses[sessionId]
      if (!status || status.type === 'idle') break
      if (Date.now() > deadline) break
      await Bun.sleep(500)
    }

    const messages = await opencode.getSessionMessages(sessionId, hiddenCwd, 20).catch(() => null)
    const assistant = extractLastAssistantText(messages)
    const parsed = tryParseJson(assistant)
    const list = Array.isArray(parsed?.artifacts) ? parsed.artifacts : []

    const wanted = new Set(items.map((i) => i.id))
    const out: EnrichmentResult[] = []
    for (const entry of list) {
      const id = typeof entry?.id === 'string' ? entry.id : ''
      if (!wanted.has(id)) continue
      const summary = typeof entry?.summary === 'string' ? entry.summary.trim() : ''
      const tags = Array.isArray(entry?.tags) ? entry.tags.map(String).map((t: string) => t.trim().toLowerCase()).filter((t: string) => t.length > 0).slice(0, 8) : []
      if (!summary) continue
      out.push({ id, summary, tags })
    }
    return out
  } finally {
    await opencode.deleteSession(sessionId, hiddenCwd).catch(() => false)
  }
}

function extractLastAssistantText(messages: any): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    const role =
      msg?.info?.role ??
      msg?.role ??
      msg?.message?.role
    if (role !== 'assistant') continue
    const parts = msg?.parts ?? msg?.message?.parts ?? msg?.message?.content ?? []
    if (Array.isArray(parts)) {
      const chunks: string[] = []
      for (const p of parts) {
        if (p?.type === 'text' && typeof p.text === 'string') chunks.push(p.text)
        if (typeof p?.content === 'string') chunks.push(p.content)
      }
      if (chunks.length > 0) return chunks.join('\n')
    }
  }
  return ''
}

function tryParseJson(text: string): any | null {
  const t = (text ?? '').trim()
  if (!t) return null
  // Extract first JSON object if wrapped in markdown
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1].trim() : t
  try {
    return JSON.parse(candidate)
  } catch {
    // Try to find first {...} region
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

