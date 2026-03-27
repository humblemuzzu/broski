/**
 * Custom SDK MCP Tools for Claude Code
 * 
 * This module enables users to define custom tools that Claude Code can use.
 * Tools are stored in ~/.broski/custom-tools.json and are loaded at runtime.
 * 
 * Handler types:
 * - http: Makes HTTP requests to external APIs
 * - script: Executes local scripts/commands
 * - builtin: Reserved for built-in Broski tools
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

import { getDefaultAllowedPaths } from './platform'

// Storage path for custom tools
const BROSKI_DIR = join(homedir(), '.broski')
const CUSTOM_TOOLS_FILE = join(BROSKI_DIR, 'custom-tools.json')

const SECURITY_ALLOWED_BASE_PATHS = (() => {
  const raw = (process.env.BROSKI_ALLOWED_BASE_PATHS ?? '').trim()
  const defaults = getDefaultAllowedPaths()
  const bases = raw
    ? raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
    : defaults
  return bases.map((p) => resolve(p))
})()

function isSecureBasePath(realPath: string): boolean {
  return SECURITY_ALLOWED_BASE_PATHS.some((base) => realPath === base || realPath.startsWith(base + sep))
}

async function getSecurePath(requestedPath: string): Promise<string | null> {
  try {
    if (!requestedPath || typeof requestedPath !== 'string') return null
    if (requestedPath.length > 4096) return null
    if (requestedPath.includes('\0')) return null
    if (/[\u0000-\u001F]/.test(requestedPath)) return null

    const expandedPath = requestedPath.startsWith('~')
      ? requestedPath.replace(/^~/, homedir())
      : requestedPath

    const abs = resolve(expandedPath)
    if (!isSecureBasePath(abs)) return null

    const rp = await realpath(abs).catch(() => null)
    if (!rp) return null
    return isSecureBasePath(rp) ? rp : null
  } catch {
    return null
  }
}

function splitCommandLine(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: 'single' | 'double' | null = null
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quote === 'single') {
      if (ch === "'") {
        quote = null
      } else {
        cur += ch
      }
      continue
    }
    if (quote === 'double') {
      if (ch === '"') {
        quote = null
      } else if (ch === '\\' && i + 1 < input.length) {
        // Basic escape support in double quotes
        i += 1
        cur += input[i]
      } else {
        cur += ch
      }
      continue
    }

    if (ch === "'") {
      quote = 'single'
      continue
    }
    if (ch === '"') {
      quote = 'double'
      continue
    }
    if (ch === '\\' && i + 1 < input.length) {
      i += 1
      cur += input[i]
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (cur) {
        out.push(cur)
        cur = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}

async function runCommand(
  file: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolvePromise) => {
    const proc = spawn(file, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const chunksOut: Buffer[] = []
    const chunksErr: Buffer[] = []
    let timedOut = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          try {
            proc.kill('SIGKILL')
          } catch {
            // ignore
          }
        }, Math.max(1, options.timeoutMs))
      : null

    proc.stdout?.on('data', (b) => chunksOut.push(Buffer.from(b)))
    proc.stderr?.on('data', (b) => chunksErr.push(Buffer.from(b)))

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolvePromise({
        code,
        stdout: Buffer.concat(chunksOut).toString('utf-8'),
        stderr: Buffer.concat(chunksErr).toString('utf-8'),
        timedOut,
      })
    })
  })
}

/**
 * Parameter definition for a custom tool
 */
export interface CustomToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description?: string
  required?: boolean
  default?: unknown
  enum?: string[] // For string types with fixed options
}

/**
 * HTTP handler configuration
 */
export interface HttpHandlerConfig {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  headers?: Record<string, string>
  bodyTemplate?: string // JSON template with {{param}} placeholders
  responseJqPath?: string // jq-like path to extract from response
}

/**
 * Script handler configuration
 */
export interface ScriptHandlerConfig {
  command: string // Command or script path
  args?: string[] // Static arguments
  cwd?: string // Working directory
  timeout?: number // Timeout in ms
  shell?: boolean // Run in shell
}

/**
 * Builtin handler configuration (reserved for future use)
 */
export interface BuiltinHandlerConfig {
  action: string
  config?: Record<string, unknown>
}

/**
 * Custom tool definition
 */
export interface CustomToolDefinition {
  id: string
  name: string
  description: string
  parameters: CustomToolParameter[]
  handler: 'http' | 'script' | 'builtin'
  handlerConfig: HttpHandlerConfig | ScriptHandlerConfig | BuiltinHandlerConfig
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/**
 * Custom tools storage format
 */
interface CustomToolsStorage {
  version: number
  tools: CustomToolDefinition[]
}

// In-memory cache of custom tools
let customToolsCache: CustomToolDefinition[] = []

/**
 * Ensure the broski directory exists
 */
async function ensureBroskiDir(): Promise<void> {
  try {
    await mkdir(BROSKI_DIR, { recursive: true })
  } catch {
    // Directory already exists
  }
}

/**
 * Load custom tools from storage
 */
export async function loadCustomTools(): Promise<CustomToolDefinition[]> {
  try {
    const content = await readFile(CUSTOM_TOOLS_FILE, 'utf-8')
    const storage: CustomToolsStorage = JSON.parse(content)
    customToolsCache = storage.tools || []
    return customToolsCache
  } catch {
    // File doesn't exist or is invalid, return empty array
    customToolsCache = []
    return []
  }
}

/**
 * Save custom tools to storage
 */
async function saveCustomTools(tools: CustomToolDefinition[]): Promise<void> {
  await ensureBroskiDir()
  const storage: CustomToolsStorage = {
    version: 1,
    tools,
  }
  await writeFile(CUSTOM_TOOLS_FILE, JSON.stringify(storage, null, 2), 'utf-8')
  customToolsCache = tools
}

/**
 * Get all custom tools
 */
export async function getCustomTools(): Promise<CustomToolDefinition[]> {
  if (customToolsCache.length === 0) {
    await loadCustomTools()
  }
  return customToolsCache
}

/**
 * Get a single custom tool by ID
 */
export async function getCustomTool(id: string): Promise<CustomToolDefinition | undefined> {
  const tools = await getCustomTools()
  return tools.find(t => t.id === id)
}

/**
 * Create or update a custom tool
 */
export async function saveCustomTool(tool: CustomToolDefinition): Promise<CustomToolDefinition> {
  const tools = await getCustomTools()
  const existingIndex = tools.findIndex(t => t.id === tool.id)
  
  const now = Date.now()
  const updatedTool = {
    ...tool,
    updatedAt: now,
    createdAt: existingIndex >= 0 ? tools[existingIndex]!.createdAt : now,
  }
  
  if (existingIndex >= 0) {
    tools[existingIndex] = updatedTool
  } else {
    tools.push(updatedTool)
  }
  
  await saveCustomTools(tools)
  return updatedTool
}

/**
 * Delete a custom tool
 */
export async function deleteCustomTool(id: string): Promise<boolean> {
  const tools = await getCustomTools()
  const index = tools.findIndex(t => t.id === id)
  
  if (index >= 0) {
    tools.splice(index, 1)
    await saveCustomTools(tools)
    return true
  }
  
  return false
}

/**
 * Build a Zod schema from parameter definitions
 */
function buildZodSchema(parameters: CustomToolParameter[]): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {}
  
  for (const param of parameters) {
    let schema: z.ZodType
    
    switch (param.type) {
      case 'string':
        schema = param.enum?.length 
          ? z.enum(param.enum as [string, ...string[]])
          : z.string()
        break
      case 'number':
        schema = z.number()
        break
      case 'boolean':
        schema = z.boolean()
        break
      case 'array':
        schema = z.array(z.any())
        break
      case 'object':
        schema = z.record(z.string(), z.any())
        break
      default:
        schema = z.any()
    }
    
    if (param.description) {
      schema = schema.describe(param.description)
    }
    
    if (!param.required) {
      schema = schema.optional()
    }
    
    if (param.default !== undefined) {
      schema = schema.default(param.default)
    }
    
    shape[param.name] = schema
  }
  
  return shape
}

/**
 * Replace template placeholders with actual values
 */
function replaceTemplatePlaceholders(template: string, args: Record<string, unknown>): string {
  let result = template
  for (const [key, value] of Object.entries(args)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
    result = result.replace(placeholder, String(value ?? ''))
  }
  return result
}

/**
 * Handle HTTP tool execution
 */
async function handleHttpTool(
  config: HttpHandlerConfig,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    // Replace placeholders in URL
    const url = replaceTemplatePlaceholders(config.url, args)
    
    // Build request options
    const requestInit: RequestInit = {
      method: config.method,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
    }
    
    // Add body for non-GET requests
    if (config.method !== 'GET') {
      if (config.bodyTemplate) {
        requestInit.body = replaceTemplatePlaceholders(config.bodyTemplate, args)
      } else {
        requestInit.body = JSON.stringify(args)
      }
    }
    
    const response = await fetch(url, requestInit)
    const responseText = await response.text()
    
    let data: unknown
    try {
      data = JSON.parse(responseText)
    } catch {
      data = responseText
    }
    
    // Format the response
    const resultText = typeof data === 'string' 
      ? data 
      : JSON.stringify(data, null, 2)
    
    if (!response.ok) {
      return {
        content: [{
          type: 'text',
          text: `HTTP Error ${response.status}: ${response.statusText}\n${resultText}`,
        }],
      }
    }
    
    return {
      content: [{
        type: 'text',
        text: resultText,
      }],
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error executing HTTP tool: ${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }
}

/**
 * Handle script tool execution
 */
async function handleScriptTool(
  config: ScriptHandlerConfig,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    // Security: custom tools execute on the user's machine. We do NOT run via a shell
    // (prevents injection through placeholder substitution).
    if (config.shell === true) {
      return {
        content: [
          {
            type: 'text',
            text:
              'Refusing to run custom tool with shell=true. For security, Broski only supports direct program execution (shell: false).',
          },
        ],
      }
    }

    const cmdRaw = replaceTemplatePlaceholders(config.command, args).trim()
    const base = splitCommandLine(cmdRaw)
    if (base.length === 0) {
      return {
        content: [{ type: 'text', text: 'Invalid script command (empty)' }],
      }
    }

    const file = base[0]!
    const finalArgs: string[] = [...base.slice(1)]
    if (config.args?.length) {
      for (const a of config.args) {
        finalArgs.push(replaceTemplatePlaceholders(a, args))
      }
    }

    const secureCwd = config.cwd ? await getSecurePath(config.cwd) : null
    if (config.cwd && !secureCwd) {
      return {
        content: [{ type: 'text', text: 'Refusing to run: cwd is outside allowed base paths' }],
      }
    }

    const result = await runCommand(file, finalArgs, {
      cwd: secureCwd ?? undefined,
      timeoutMs: config.timeout,
    })

    const output: string[] = []
    if (result.timedOut) output.push('Error: command timed out')
    if (result.stdout) output.push(`Output:\n${result.stdout}`)
    if (result.stderr) output.push(`Stderr:\n${result.stderr}`)

    const ok = result.code === 0 && !result.timedOut
    return {
      content: [
        {
          type: 'text',
          text: output.length
            ? output.join('\n\n')
            : ok
              ? 'Command executed successfully (no output)'
              : `Command failed (exit ${result.code ?? 'unknown'})`,
        },
      ],
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error executing script: ${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }
}

/**
 * Handle builtin tool execution (placeholder for future)
 */
async function handleBuiltinTool(
  config: BuiltinHandlerConfig,
  _args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return {
    content: [{
      type: 'text',
      text: `Builtin tool '${config.action}' is not yet implemented`,
    }],
  }
}

/**
 * Create a handler function for a custom tool
 */
function createToolHandler(toolDef: CustomToolDefinition) {
  return async (args: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
    switch (toolDef.handler) {
      case 'http':
        return handleHttpTool(toolDef.handlerConfig as HttpHandlerConfig, args)
      case 'script':
        return handleScriptTool(toolDef.handlerConfig as ScriptHandlerConfig, args)
      case 'builtin':
        return handleBuiltinTool(toolDef.handlerConfig as BuiltinHandlerConfig, args)
      default:
        return {
          content: [{
            type: 'text',
            text: `Unknown handler type: ${toolDef.handler}`,
          }],
        }
    }
  }
}

/**
 * Create an SDK MCP server with all enabled custom tools
 */
export async function createCustomToolsServer(
  serverName: string = 'broski-custom-tools'
): Promise<ReturnType<typeof createSdkMcpServer> | null> {
  const tools = await getCustomTools()
  const enabledTools = tools.filter(t => t.enabled)
  
  if (enabledTools.length === 0) {
    return null
  }
  
  const toolInstances = enabledTools.map(toolDef => 
    tool(
      toolDef.name,
      toolDef.description,
      buildZodSchema(toolDef.parameters),
      createToolHandler(toolDef),
    )
  )
  
  return createSdkMcpServer({
    name: serverName,
    version: '1.0.0',
    tools: toolInstances,
  })
}

/**
 * Test a custom tool with sample arguments
 */
export async function testCustomTool(
  toolDef: CustomToolDefinition,
  testArgs: Record<string, unknown>
): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    const handler = createToolHandler(toolDef)
    const result = await handler(testArgs)
    
    return {
      success: true,
      result: result.content[0]?.text || 'No output',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Get the tool name as it will appear in Claude Code
 * Format: mcp__serverName__toolName
 */
export function getToolMcpName(toolName: string, serverName: string = 'broski-custom-tools'): string {
  return `mcp__${serverName}__${toolName}`
}

/**
 * Validate a custom tool definition
 */
export function validateCustomTool(toolDef: Partial<CustomToolDefinition>): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  
  if (!toolDef.name?.trim()) {
    errors.push('Tool name is required')
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(toolDef.name)) {
    errors.push('Tool name must start with a letter or underscore and contain only alphanumeric characters and underscores')
  }
  
  if (!toolDef.description?.trim()) {
    errors.push('Tool description is required')
  }
  
  if (!toolDef.handler) {
    errors.push('Handler type is required')
  }
  
  if (toolDef.handler === 'http') {
    const config = toolDef.handlerConfig as HttpHandlerConfig | undefined
    if (!config?.url?.trim()) {
      errors.push('HTTP URL is required')
    }
    if (!config?.method) {
      errors.push('HTTP method is required')
    }
  }
  
  if (toolDef.handler === 'script') {
    const config = toolDef.handlerConfig as ScriptHandlerConfig | undefined
    if (!config?.command?.trim()) {
      errors.push('Script command is required')
    }
  }
  
  // Validate parameters
  if (toolDef.parameters) {
    for (const param of toolDef.parameters) {
      if (!param.name?.trim()) {
        errors.push('Parameter name is required')
      }
      if (!param.type) {
        errors.push(`Parameter "${param.name}" needs a type`)
      }
    }
    
    // Check for duplicate parameter names
    const names = toolDef.parameters.map(p => p.name)
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i)
    if (duplicates.length > 0) {
      errors.push(`Duplicate parameter names: ${[...new Set(duplicates)].join(', ')}`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Generate a unique tool ID
 */
export function generateToolId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
