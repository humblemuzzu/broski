import type { AgentType, AgentStatusInfo, FileAttachment } from './types'
import * as opencode from './connectors/opencode'
import * as claudeCode from './connectors/claude-code'
import { checkCodexAvailable } from './connectors/codex'
import * as pi from './connectors/pi'

export type QueryOptions = {
  agentType: AgentType
  prompt: string
  cwd: string
  sessionId?: string
  model?: string
  subagent?: string  // For OpenCode subagent selection (build/plan)
  disabledTools?: string[]
  fileAttachments?: FileAttachment[]
}

export async function getAgentStatus(): Promise<Record<AgentType, AgentStatusInfo>> {
  const opencodeAvailable = await opencode.checkAvailable()
  const claudeCodeAvailable = await claudeCode.checkClaudeCodeAvailable()
  const codexAvailable = await checkCodexAvailable()
  const piStatus = await pi.isPiAvailable()

  return {
    opencode: {
      available: opencodeAvailable,
      authMethod: 'sdk',
    },
    'claude-code': {
      available: claudeCodeAvailable,
      authMethod: claudeCodeAvailable ? 'api-key' : 'none',
    },
    codex: {
      available: codexAvailable,
      authMethod: codexAvailable ? 'cli' : 'none',
    },
    pi: {
      available: piStatus.available,
      authMethod: piStatus.authenticated ? 'configured' : 'none',
      version: piStatus.version,
    },
  }
}

export async function routeQuery(
  options: QueryOptions,
  onMessage: (message: any) => void,
  onComplete: (sessionId: string) => void,
  onError: (error: Error) => void,
): Promise<void> {
  const { agentType, prompt, cwd, sessionId, model, subagent, disabledTools, fileAttachments } = options

  switch (agentType) {
    case 'opencode':
      return opencode.sendPrompt(
        sessionId!,
        prompt,
        cwd,
        model ? { providerID: 'anthropic', modelID: model } : undefined,
        subagent,
        disabledTools,
        fileAttachments,
        onMessage,
        onComplete,
        onError,
      )

    case 'claude-code':
      {
        const finalPrompt = await claudeCode.preparePromptWithAttachments(
          prompt,
          cwd,
          fileAttachments,
        )
        return claudeCode.queryClaudeCode(
          finalPrompt,
          {
            cwd,
            sessionId,
            model,
            permissionMode: 'default',
          },
          onMessage,
          onComplete,
          onError,
        )
      }

    case 'pi':
      return onError(new Error('Pi routing is handled by the websocket server handler (pi_features)'))

    default:
      return onError(new Error(`Unknown agent: ${agentType}`))
  }
}

export async function abortQuery(agent: AgentType, sessionId: string): Promise<void> {
  switch (agent) {
    case 'opencode':
      return opencode.abortSession(sessionId)
    case 'claude-code':
      return claudeCode.abortClaudeCode(sessionId)
    case 'codex':
      // Codex abort is implemented via turn/interrupt in the bridge server, not here.
      return
    case 'pi':
      // Pi abort is handled by the websocket server handler (pi_features).
      return
    default:
      throw new Error(`Unknown agent: ${agent}`)
  }
}
