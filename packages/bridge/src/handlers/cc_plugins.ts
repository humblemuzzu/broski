import type { ServerMessage } from '../types'

type ReplyFn = (msg: ServerMessage | Record<string, unknown>) => void

export async function handle(
  message: Record<string, unknown>,
  reply: ReplyFn,
): Promise<boolean> {
  const type = message.type as string
  switch (type) {
    case 'cc_list_plugins': {
      const plugins = await import('../plugins')
      const pluginList = await plugins.discoverPlugins(message.cwd as string | undefined)
      reply({ type: 'cc_plugins', data: pluginList })
      return true
    }
    case 'cc_get_plugin': {
      const plugins = await import('../plugins')
      const plugin = await plugins.getPlugin(message.name as string)
      reply({ type: 'cc_plugin', data: plugin || null })
      return true
    }
    case 'cc_toggle_plugin': {
      const plugins = await import('../plugins')
      const success = await plugins.togglePlugin(message.name as string, message.enabled as boolean)
      reply({
        type: 'cc_plugin_toggled',
        data: success,
        name: message.name,
        enabled: message.enabled,
      })
      return true
    }
    case 'cc_add_plugin_path': {
      const plugins = await import('../plugins')
      const success = await plugins.addPluginPath(message.path as string)
      reply({
        type: 'cc_plugin_path_added',
        data: success,
        path: message.path,
      })
      return true
    }
    case 'cc_remove_plugin_path': {
      const plugins = await import('../plugins')
      const success = await plugins.removePluginPath(message.path as string)
      reply({
        type: 'cc_plugin_path_removed',
        data: success,
        path: message.path,
      })
      return true
    }
    case 'cc_get_plugin_config': {
      const plugins = await import('../plugins')
      const config = await plugins.getPluginConfig()
      reply({ type: 'cc_plugin_config', data: config })
      return true
    }
    case 'cc_reload_plugins': {
      const plugins = await import('../plugins')
      const pluginList = await plugins.reloadPlugins(message.cwd as string | undefined)
      reply({ type: 'cc_plugins_reloaded', data: pluginList })
      return true
    }
    default:
      return false
  }
}
