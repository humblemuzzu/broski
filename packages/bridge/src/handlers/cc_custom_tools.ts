import type { ServerMessage } from '../types'
import type { CustomToolDefinition } from '../custom-tools'

type ReplyFn = (msg: ServerMessage) => void

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
      const id = message.id as string
      const tool = await customTools.getCustomTool(id)
      reply({ type: 'cc_custom_tool', data: tool || null })
      return true
    }
    case 'cc_save_custom_tool': {
      const customTools = await import('../custom-tools')
      const toolDef = message.tool as Partial<CustomToolDefinition>
      // Validate the tool definition
      const validation = customTools.validateCustomTool(toolDef)
      if (!validation.valid) {
        reply({
          type: 'error',
          message: `Invalid tool: ${validation.errors.join(', ')}`,
        })
        return true
      }
      // Generate ID if not present
      const toolToSave: CustomToolDefinition = {
        ...(toolDef as CustomToolDefinition),
        id: toolDef.id || customTools.generateToolId(),
      }
      const savedTool = await customTools.saveCustomTool(toolToSave)
      reply({ type: 'cc_custom_tool_saved', data: savedTool })
      return true
    }
    case 'cc_delete_custom_tool': {
      const customTools = await import('../custom-tools')
      const id = message.id as string
      const deleted = await customTools.deleteCustomTool(id)
      reply({
        type: 'cc_custom_tool_deleted',
        data: deleted,
        id,
      })
      return true
    }
    case 'cc_test_custom_tool': {
      const customTools = await import('../custom-tools')
      const result = await customTools.testCustomTool(
        message.tool as CustomToolDefinition,
        (message.testArgs as Record<string, unknown>) ?? {},
      )
      reply({ type: 'cc_custom_tool_test_result', data: result })
      return true
    }
    default:
      return false
  }
}
