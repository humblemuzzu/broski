import type { AgentType, AgentStatusInfo } from './types'
import * as opencode from './connectors/opencode'
import * as claudeCode from './connectors/claude-code'

export type QueryOptions = {
  agentType: AgentType
  prompt: string
  cwd: string
  sessionId?: string
  model?: string
  subagent?: string  // For OpenCode subagent selection (build/plan)
  disabledTools?: string[]
  fileAttachments?: any[]
}

export async function getAgentStatus(): Promise<Record<AgentType, AgentStatusInfo>> {
  const opencodeAvailable = await opencode.checkAvailable()
  const claudeCodeAvailable = await claudeCode.checkClaudeCodeAvailable()

  return {
    opencode: {
      available: opencodeAvailable,
      authMethod: 'sdk',
    },
    'claude-code': {
      available: claudeCodeAvailable,
      authMethod: claudeCodeAvailable ? 'api-key' : 'none',
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
          fileAttachments as any,
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
    default:
      throw new Error(`Unknown agent: ${agent}`)
  }
}
