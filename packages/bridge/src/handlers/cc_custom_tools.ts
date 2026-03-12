import type { ServerMessage } from '../types'

type ReplyFn = (msg: ServerMessage | Record<string, unknown>) => void

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_list_custom_tools': {
      const customTools = await import('../custom-tools')
      const tools = await customTools.getCustomTools()
      reply({ type: 'cc_custom_tools', data: tools })
      return true
    }
    case 'cc_get_custom_tool': {
      const customTools = await import('../custom-tools')
      const tool = await customTools.getCustomTool(message.id as string)
      reply({ type: 'cc_custom_tool', data: tool || null })
      return true
    }
    case 'cc_save_custom_tool': {
      const customTools = await import('../custom-tools')
      // Validate the tool definition
      const validation = customTools.validateCustomTool(message.tool)
      if (!validation.valid) {
        reply({
          type: 'error',
          message: `Invalid tool: ${validation.errors.join(', ')}`,
        })
        return true
      }
      // Generate ID if not present
      const toolDef = message.tool as Record<string, unknown>
      const toolToSave = {
        ...toolDef,
        id: toolDef.id || customTools.generateToolId(),
      }
      const savedTool = await customTools.saveCustomTool(toolToSave)
      reply({ type: 'cc_custom_tool_saved', data: savedTool })
      return true
    }
    case 'cc_delete_custom_tool': {
      const customTools = await import('../custom-tools')
      const deleted = await customTools.deleteCustomTool(message.id as string)
      reply({
        type: 'cc_custom_tool_deleted',
        data: deleted,
        id: message.id,
      })
      return true
    }
    case 'cc_test_custom_tool': {
      const customTools = await import('../custom-tools')
      const result = await customTools.testCustomTool(message.tool, message.testArgs)
      reply({ type: 'cc_custom_tool_test_result', data: result })
      return true
    }
    default:
      return false
  }
}
