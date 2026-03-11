import * as pi from '../connectors/pi'
import type { ServerMessage } from '../types'
import type { PiQueueState, PiThinkingCapabilities, PiToolInfo } from '../types/pi'

type Reply = (message: ServerMessage) => void

export async function handle(message: any, reply: Reply): Promise<boolean> {
  const cwd =
    typeof message?.projectPath === 'string' && message.projectPath.trim()
      ? message.projectPath.trim()
      : typeof message?.cwd === 'string' && message.cwd.trim()
        ? message.cwd.trim()
        : undefined

  switch (message.type) {
    // ── Tool Management ──────────────────────────────────────────────
    case 'pi_get_tools': {
      const instance = await pi.getOrCreateInstance(cwd)
      const allTools = instance.session.getAllTools()
      const activeNames = instance.session.getActiveToolNames()
      const tools: (PiToolInfo & { active: boolean })[] = allTools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        active: activeNames.includes(t.name),
      }))
      reply({ type: 'pi_tools', data: tools, requestId: message.requestId })
      return true
    }

    case 'pi_get_active_tools': {
      const instance = await pi.getOrCreateInstance(cwd)
      const names = instance.session.getActiveToolNames()
      reply({ type: 'pi_active_tools', data: names, requestId: message.requestId })
      return true
    }

    case 'pi_set_active_tools': {
      const instance = await pi.getOrCreateInstance(cwd)
      const toolNames = Array.isArray(message.toolNames)
        ? message.toolNames.filter((n: unknown): n is string => typeof n === 'string')
        : []
      instance.session.setActiveToolsByName(toolNames)
      const updatedNames = instance.session.getActiveToolNames()
      reply({ type: 'pi_active_tools_set', data: updatedNames, requestId: message.requestId })
      return true
    }

    // ── Model Capabilities ───────────────────────────────────────────
    case 'pi_get_thinking_capabilities': {
      const instance = await pi.getOrCreateInstance(cwd)
      const capabilities: PiThinkingCapabilities = {
        supportsThinking: instance.session.supportsThinking(),
        supportsXhigh: instance.session.supportsXhighThinking(),
        availableLevels: instance.session.getAvailableThinkingLevels(),
      }
      reply({ type: 'pi_thinking_capabilities', data: capabilities, requestId: message.requestId })
      return true
    }

    case 'pi_list_all_models': {
      const models = pi.listAllModels()
      reply({ type: 'pi_all_models', data: models, requestId: message.requestId })
      return true
    }

    case 'pi_refresh_models': {
      pi.refreshModels()
      const models = pi.listAvailableModels()
      reply({ type: 'pi_models_refreshed', data: models, requestId: message.requestId })
      return true
    }

    // ── Queue Management ─────────────────────────────────────────────
    case 'pi_clear_queue': {
      const instance = await pi.getOrCreateInstance(cwd)
      const cleared = instance.session.clearQueue()
      const queueState: PiQueueState = {
        steering: cleared.steering,
        followUp: cleared.followUp,
      }
      reply({ type: 'pi_queue_cleared', data: queueState, requestId: message.requestId })
      return true
    }

    case 'pi_get_queue': {
      const instance = await pi.getOrCreateInstance(cwd)
      const queueState: PiQueueState = {
        steering: [...instance.session.getSteeringMessages()],
        followUp: [...instance.session.getFollowUpMessages()],
      }
      reply({ type: 'pi_queue', data: queueState, requestId: message.requestId })
      return true
    }

    // ── Misc ─────────────────────────────────────────────────────────
    case 'pi_get_last_assistant_text': {
      const instance = await pi.getOrCreateInstance(cwd)
      const text = instance.session.getLastAssistantText()
      reply({ type: 'pi_last_assistant_text', data: { text: text ?? null }, requestId: message.requestId })
      return true
    }

    default:
      return false
  }
}
