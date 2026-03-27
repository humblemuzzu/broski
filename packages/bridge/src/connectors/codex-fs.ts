/**
 * Codex Filesystem Reader
 * 
 * Reads Codex sessions directly from ~/.codex/sessions/ without spawning app-server.
 * Same pattern as Claude Code - just read the files properly.
 */

import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type {
  CodexThread,
  CodexTranscriptDiff,
  CodexTranscriptMessage,
  CodexTranscriptToolCall,
  ProjectSummary,
} from '../types'
import { computeCxThreadStats } from './codex/cx-session-stats'
import { findRolloutPathById } from './codex/cx-sqlite'

const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions')
const CODEX_ARCHIVED_SESSIONS_DIR = join(homedir(), '.codex', 'archived_sessions')

/**
 * Collect all .jsonl session files from both active and archived directories.
 */
async function collectAllSessionFiles(): Promise<string[]> {
  const [activeFiles, archivedFiles] = await Promise.all([
    collectSessionFiles(CODEX_SESSIONS_DIR),
    collectSessionFiles(CODEX_ARCHIVED_SESSIONS_DIR),
  ])
  return [...activeFiles, ...archivedFiles]
}

/**
 * Extract the actual user prompt from a Codex user_message.
 */
function extractUserPrompt(message: string): string {
  const marker = '## My request for Codex:'
  const idx = message.indexOf(marker)
  if (idx !== -1) {
    return message.slice(idx + marker.length).trim()
  }
  if (message.startsWith('# Context from my IDE setup:')) {
    const lines = message.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('##')) {
        return lines.slice(i).join('\n').trim()
      }
    }
  }
  return message.trim()
}

/**
 * Read and parse a Codex session file to extract metadata and preview.
 * Handles both formats:
 * - New: event_msg with payload.type === 'user_message'
 * - Old: response_item with payload.content[].type === 'input_text'
 */
async function readSessionMeta(filePath: string): Promise<{
  id: string
  cwd: string
  cliVersion?: string
  modelProvider?: string
  gitBranch?: string
  preview?: string
} | null> {
  try {
    const file = Bun.file(filePath)
    const text = await file.text()
    const lines = text.split('\n')
    
    // First line must be session_meta
    const firstLine = lines[0]
    if (!firstLine) return null
    
    const meta = JSON.parse(firstLine)
    if (meta?.type !== 'session_meta') return null
    
    const payload = meta.payload ?? {}
    
    // Find first user message for preview
    let preview: string | undefined
    
    for (const line of lines) {
      if (preview) break
      if (!line.trim()) continue
      
      try {
        const record = JSON.parse(line)
        
        // New format: event_msg with user_message
        if (record?.type === 'event_msg' && 
            record?.payload?.type === 'user_message' &&
            typeof record?.payload?.message === 'string') {
          const userPrompt = extractUserPrompt(record.payload.message)
          if (userPrompt) {
            preview = userPrompt.slice(0, 300)
            break
          }
        }
        
        // Old format: response_item with input_text content
        if (record?.type === 'response_item' && 
            record?.payload?.role === 'user' &&
            Array.isArray(record?.payload?.content)) {
          for (const block of record.payload.content) {
            if (block?.type === 'input_text' && typeof block?.text === 'string') {
              const text = block.text
              // Skip system instructions and context blocks
              if (text.startsWith('<user_instructions>') ||
                  text.startsWith('<environment_context>') ||
                  text.startsWith('# AGENTS.md') ||
                  text.startsWith('# Repository Guidelines') ||
                  text.startsWith('# Continuity Ledger')) {
                continue
              }
              const userPrompt = extractUserPrompt(text)
              if (userPrompt) {
                preview = userPrompt.slice(0, 300)
                break
              }
            }
          }
        }
      } catch {
        continue
      }
    }
    
    return {
      id: payload.id ?? '',
      cwd: payload.cwd ?? '',
      cliVersion: payload.cli_version,
      modelProvider: payload.model_provider,
      gitBranch: payload.git?.branch,
      preview,
    }
  } catch {
    return null
  }
}

/**
 * Recursively collect all .jsonl files in the sessions directory.
 */
async function collectSessionFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  
  async function scan(d: string): Promise<void> {
    try {
      const entries = await readdir(d, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(d, entry.name)
        if (entry.isDirectory()) {
          await scan(fullPath)
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(fullPath)
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }
  }
  
  await scan(dir)
  return files
}

/**
 * List all Codex threads (sessions) directly from filesystem.
 */
export async function listThreadsFromFs(cwd?: string): Promise<CodexThread[]> {
  const normalizedCwd = cwd ? resolve(cwd) : null
  const files = await collectAllSessionFiles()
  const threads: (CodexThread & { _filePath?: string })[] = []
  
  for (const filePath of files) {
    const [fileStat, meta] = await Promise.all([
      stat(filePath).catch(() => null),
      readSessionMeta(filePath),
    ])
    
    if (!fileStat || !meta || !meta.id) continue
    
    // Filter by cwd if specified
    const sessionCwd = meta.cwd ? resolve(meta.cwd) : ''
    if (normalizedCwd && sessionCwd !== normalizedCwd) continue
    
    threads.push({
      id: meta.id,
      preview: meta.preview ?? `Session ${meta.id.slice(0, 8)}`,
      modelProvider: meta.modelProvider,
      createdAt: Math.floor(fileStat.birthtime.getTime() / 1000),
      updatedAt: Math.floor(fileStat.mtime.getTime() / 1000),
      cwd: meta.cwd,
      cliVersion: meta.cliVersion,
      gitInfo: meta.gitBranch ? { branch: meta.gitBranch } : null,
      _filePath: filePath,
    })
  }

  threads.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  // Compute diff stats in parallel (cached by mtime)
  await Promise.all(
    threads.map(async (thread) => {
      const fp = thread._filePath
      if (!fp) return
      const summary = await computeCxThreadStats(fp, thread.id)
      if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
        thread.summary = summary
      }
      delete thread._filePath
    }),
  )

  return threads
}

/**
 * List all unique projects from Codex sessions.
 */
export async function listProjectsFromFs(): Promise<ProjectSummary[]> {
  const files = await collectAllSessionFiles()
  const byPath = new Map<string, { path: string; name: string; lastOpened: number }>()

  for (const filePath of files) {
    const [fileStat, meta] = await Promise.all([
      stat(filePath).catch(() => null),
      readSessionMeta(filePath),
    ])
    
    if (!fileStat || !meta || !meta.cwd) continue

    const path = resolve(meta.cwd)
    const lastOpened = Math.floor(fileStat.mtime.getTime() / 1000)
    const existing = byPath.get(path)

    if (!existing || lastOpened > existing.lastOpened) {
      byPath.set(path, {
        path,
        name: basename(path) || path,
        lastOpened,
      })
    }
  }

  return Array.from(byPath.values())
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .map((p) => ({
      id: p.path,
      name: p.name,
      path: p.path,
      lastOpened: p.lastOpened,
    }))
}

/**
 * Get a specific thread by ID from filesystem.
 */
export async function getThreadFromFs(threadId: string): Promise<CodexThread | null> {
  const files = await collectAllSessionFiles()
  
  for (const filePath of files) {
    const meta = await readSessionMeta(filePath)
    if (meta?.id === threadId) {
      const fileStat = await stat(filePath).catch(() => null)
      const summary = await computeCxThreadStats(filePath, threadId)
      return {
        id: meta.id,
        preview: meta.preview ?? `Session ${meta.id.slice(0, 8)}`,
        modelProvider: meta.modelProvider,
        createdAt: fileStat ? Math.floor(fileStat.birthtime.getTime() / 1000) : 0,
        updatedAt: fileStat ? Math.floor(fileStat.mtime.getTime() / 1000) : 0,
        cwd: meta.cwd,
        cliVersion: meta.cliVersion,
        gitInfo: meta.gitBranch ? { branch: meta.gitBranch } : null,
        ...(summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0) ? { summary } : {}),
      }
    }
  }
  return null
}

/**
 * Find the session file path for a thread ID.
 * Tries SQLite lookup first (instant), then falls back to filesystem scan.
 */
export async function findThreadFilePath(threadId: string): Promise<string | null> {
  // Fast path: SQLite has a rollout_path index — O(1) lookup.
  const sqlitePath = findRolloutPathById(threadId)
  if (sqlitePath) return sqlitePath

  // Slow path: scan all JSONL files for a matching session_meta.id.
  const files = await collectAllSessionFiles()
  
  for (const filePath of files) {
    const meta = await readSessionMeta(filePath)
    if (meta?.id === threadId) {
      return filePath
    }
  }
  return null
}

// ============================================================================
// TRANSCRIPT MESSAGE TYPES (must match `packages/bridge/src/types.ts`)
// ============================================================================

type TranscriptToolCall = CodexTranscriptToolCall
type TranscriptDiff = CodexTranscriptDiff
type TranscriptMessage = CodexTranscriptMessage

function safeStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function countDiffAddsDels(diff: string): { adds: number; dels: number } {
  let adds = 0, dels = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) adds++
    else if (line.startsWith('-')) dels++
  }
  return { adds, dels }
}

function headTailTruncate(text: string, headLines: number, tailLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= headLines + tailLines + 5) return text
  const head = lines.slice(0, headLines).join('\n')
  const tail = lines.slice(-tailLines).join('\n')
  const omitted = lines.length - headLines - tailLines
  return `${head}\n\n... (${omitted} lines omitted) ...\n\n${tail}`
}

/**
 * Read thread messages directly from the session file.
 * Returns transcript in the same format as buildCodexTranscript in server.ts.
 * 
 * Codex session file structure:
 * - session_meta: session info (skip)
 * - response_item role=user: SYSTEM CONTEXT blocks like AGENTS.md, environment (skip these!)
 * - event_msg type=user_message: THE ACTUAL USER INPUT (use this!)
 * - event_msg type=agent_reasoning: Thinking text (e.g., "Updating progress")
 * - response_item type=reasoning: More detailed reasoning
 * - response_item type=function_call: Tool call start
 * - response_item type=function_call_output: Tool call result
 * - response_item type=custom_tool_call: apply_patch results
 * - response_item type=message role=assistant: FINAL ASSISTANT TEXT (the summary/explanation)
 */
export async function getThreadMessagesFromFs(threadId: string): Promise<TranscriptMessage[]> {
  const filePath = await findThreadFilePath(threadId)
  if (!filePath) return []

  try {
    const file = Bun.file(filePath)
    const text = await file.text()
    const lines = text.split('\n').filter(l => l.trim())
    
    const out: TranscriptMessage[] = []
    let seq = 0
    let currentAssistant: TranscriptMessage | null = null
    const baseTime = Math.floor(Date.now() / 1000) - lines.length
    
    const pushUser = (text: string) => {
      out.push({
        id: `user_${baseTime}_${seq}`,
        role: 'user',
        createdAt: baseTime + seq,
        text,
      })
      seq++
      currentAssistant = null // Reset - next assistant content starts fresh
    }
    
    const startNewAssistant = (thinking?: string): TranscriptMessage => {
      // If current assistant has no content yet, reuse it
      if (currentAssistant && !currentAssistant.text && !currentAssistant.thinking && 
          (!currentAssistant.toolCalls || currentAssistant.toolCalls.length === 0)) {
        if (thinking) currentAssistant.thinking = thinking
        return currentAssistant
      }
      
      const msg: TranscriptMessage = {
        id: `assistant_${baseTime}_${seq}`,
        role: 'assistant',
        createdAt: baseTime + seq,
        text: '',
        thinking: thinking || undefined,
        toolCalls: [],
        diffs: [],
      }
      out.push(msg)
      seq++
      currentAssistant = msg
      return msg
    }
    
    const getOrCreateAssistant = (): TranscriptMessage => {
      if (currentAssistant) return currentAssistant
      return startNewAssistant()
    }
    
    for (const line of lines) {
      try {
        const record = JSON.parse(line)
        const type = safeStr(record?.type)
        const payload = record?.payload ?? {}
        
        // Skip metadata and token counts
        if (type === 'session_meta' || type === 'turn_context') continue
        if (type === 'event_msg' && payload?.type === 'token_count') continue
        
        // ===== USER MESSAGE (the REAL one) =====
        if (type === 'event_msg' && payload?.type === 'user_message') {
          const rawMsg = safeStr(payload?.message)
          const userText = extractUserPrompt(rawMsg)
          if (userText) {
            pushUser(userText)
          }
          continue
        }
        
        // ===== SKIP system context blocks (response_item role=user) =====
        // These are AGENTS.md, environment context, etc. - NOT actual user input
        if (type === 'response_item' && payload?.type === 'message' && payload?.role === 'user') {
          // Skip entirely - the real user message comes from event_msg type=user_message
          continue
        }
        
        // ===== THINKING: Each agent_reasoning starts a new thinking block =====
        if (type === 'event_msg' && payload?.type === 'agent_reasoning') {
          const thinking = safeStr(payload?.text)
          if (thinking) {
            // Start new assistant block with this thinking
            startNewAssistant(thinking)
          }
          continue
        }
        
        // ===== Additional reasoning summary (append to current) =====
        if (type === 'response_item' && payload?.type === 'reasoning') {
          const summary = Array.isArray(payload?.summary)
            ? payload.summary.map((s: any) => safeStr(s?.text)).join('\n')
            : ''
          if (summary) {
            const a = getOrCreateAssistant()
            a.thinking = ((a.thinking ?? '') + '\n' + summary).trim()
          }
          continue
        }
        
        // ===== FINAL ASSISTANT TEXT =====
        if (type === 'response_item' && payload?.type === 'message' && payload?.role === 'assistant') {
          const content = Array.isArray(payload?.content) ? payload.content : []
          const textParts: string[] = []
          for (const c of content) {
            if (safeStr(c?.type) === 'output_text') {
              textParts.push(safeStr(c?.text))
            }
          }
          const finalText = textParts.filter(Boolean).join('\n\n').trim()
          if (finalText) {
            const a = getOrCreateAssistant()
            a.text = finalText
          }
          continue
        }
        
        // ===== TOOL CALLS =====
        if (type === 'response_item' && payload?.type === 'function_call') {
          const a = getOrCreateAssistant()
          a.toolCalls = a.toolCalls ?? []
          
          const name = safeStr(payload?.name)
          const callId = safeStr(payload?.call_id)
          let args: Record<string, unknown> = {}
          try {
            args = typeof payload?.arguments === 'string'
              ? JSON.parse(payload.arguments)
              : payload?.arguments ?? {}
          } catch { /* ignore */ }
          
          // Map tool names to types
          if (name === 'shell_command' || name === 'shell') {
            a.toolCalls.push({
              itemId: callId,
              type: 'commandExecution',
              name: 'Bash',
              status: 'running',
              input: args,
            })
          } else if (name === 'apply_patch') {
            a.toolCalls.push({
              itemId: callId,
              type: 'fileChange',
              name: 'ApplyPatch',
              status: 'running',
              input: args,
            })
          } else {
            a.toolCalls.push({
              itemId: callId,
              type: 'mcpToolCall',
              name: name,
              status: 'running',
              input: args,
            })
          }
          continue
        }
        
        // ===== TOOL CALL OUTPUTS =====
        if (type === 'response_item' && payload?.type === 'function_call_output') {
          const callId = safeStr(payload?.call_id)
          const output = safeStr(payload?.output)
          
          // Find and update the matching tool call in current assistant
          const toolCalls = (currentAssistant as TranscriptMessage | null)?.toolCalls
          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              if (tc.itemId === callId) {
                tc.status = 'completed'
                tc.output = headTailTruncate(output, 50, 30)
                break
              }
            }
          }
          continue
        }
        
        // ===== CUSTOM TOOL CALLS (apply_patch with status) =====
        if (type === 'response_item' && payload?.type === 'custom_tool_call') {
          const a = getOrCreateAssistant()
          a.toolCalls = a.toolCalls ?? []
          a.diffs = a.diffs ?? []
          
          const name = safeStr(payload?.name)
          const status = safeStr(payload?.status)
          const callId = safeStr(payload?.call_id)
          const input = safeStr(payload?.input)
          
          if (name === 'apply_patch') {
            // Parse the patch to extract file changes
            const patchMatch = input.match(/\*\*\* Update File: ([^\n]+)/)
            const file = patchMatch ? patchMatch[1] : 'unknown'
            
            a.toolCalls.push({
              itemId: callId,
              type: 'fileChange',
              name: 'ApplyPatch',
              status: status === 'completed' ? 'completed' : 'running',
              input: { patch: input },
              output: input,
            })
            
            // Add diff info
            const { adds, dels } = countDiffAddsDels(input)
            a.diffs.push({
              file,
              diff: input,
              additions: adds,
              deletions: dels,
              itemId: callId,
            })
          }
          continue
        }
        
      } catch {
        // Skip unparseable lines
        continue
      }
    }
    
    return out
  } catch {
    return []
  }
}

/**
 * Enrich a list of Codex threads with diff stats from the filesystem.
 * Builds a threadId→filePath index first, then computes stats in parallel.
 * Safe to call on threads from RPC or filesystem — skips threads that already have summary.
 */
export async function enrichThreadsWithStats(threads: CodexThread[]): Promise<void> {
  const needStats = threads.filter((t) => !t.summary)
  if (needStats.length === 0) return

  // Build threadId→filePath index (scan both active and archived directories)
  const files = await collectAllSessionFiles()
  const idToFile = new Map<string, string>()
  await Promise.all(
    files.map(async (filePath) => {
      const meta = await readSessionMeta(filePath)
      if (meta?.id) idToFile.set(meta.id, filePath)
    }),
  )

  // Compute stats in parallel
  await Promise.all(
    needStats.map(async (thread) => {
      const fp = idToFile.get(thread.id)
      if (!fp) return
      const summary = await computeCxThreadStats(fp, thread.id)
      if (summary && (summary.additions > 0 || summary.deletions > 0 || summary.files > 0)) {
        thread.summary = summary
      }
    }),
  )
}
