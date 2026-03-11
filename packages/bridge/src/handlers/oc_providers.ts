import type { ClientMessage, ServerMessage } from '../types'
import { mapOpenCodeProvidersToRuntimeModels } from '../runtime/opencode-runtime-read-models'

type Reply = (message: ServerMessage) => void

type OpenCodeProviderLike = {
  listProviders: () => Promise<any>
  listAllProviders: (dir?: string) => Promise<any>
  getProviderAuth: (dir?: string) => Promise<any>
  providerOauthAuthorize: (
    id: string,
    method: string,
    dir?: string,
  ) => Promise<any>
  providerOauthCallback: (
    id: string,
    method: string,
    code?: string,
    dir?: string,
  ) => Promise<boolean>
  authSet: (providerId: string, auth: any) => Promise<boolean>
  authRemove: (providerId: string) => Promise<boolean>
}

export async function handle(
  message: ClientMessage & { requestId?: string },
  reply: Reply,
  requireOpenCode: () => OpenCodeProviderLike,
): Promise<boolean> {
  switch (message.type) {
    case 'list_providers': {
      const oc = requireOpenCode()
      const providers = await oc.listProviders()
      reply({ type: 'providers', data: providers })
      return true
    }
    case 'list_all_providers': {
      const oc = requireOpenCode()
      const providers = await oc.listAllProviders(message.projectPath)
      reply({ type: 'all_providers', data: providers })
      reply({
        type: 'runtime_models',
        backend: 'opencode',
        data: mapOpenCodeProvidersToRuntimeModels(providers),
      })
      return true
    }
    case 'get_provider_auth': {
      const oc = requireOpenCode()
      const auth = await oc.getProviderAuth(message.projectPath)
      reply({ type: 'provider_auth', data: auth })
      return true
    }
    case 'provider_oauth_authorize': {
      const oc = requireOpenCode()
      const data = await oc.providerOauthAuthorize(
        (message as any).providerId,
        (message as any).method,
        message.projectPath,
      )
      reply({
        type: 'provider_oauth_authorized',
        data,
        providerId: (message as any).providerId,
      })
      return true
    }
    case 'provider_oauth_callback': {
      const oc = requireOpenCode()
      const ok = await oc.providerOauthCallback(
        (message as any).providerId,
        (message as any).method,
        (message as any).code,
        message.projectPath,
      )
      reply({
        type: 'provider_oauth_callback',
        data: ok,
        providerId: (message as any).providerId,
      })
      return true
    }
    case 'auth_set': {
      const oc = requireOpenCode()
      const ok = await oc.authSet(
        (message as any).providerId,
        (message as any).auth,
      )
      reply({
        type: 'auth_set_result',
        data: ok,
        providerId: (message as any).providerId,
      })
      return true
    }
    case 'auth_remove': {
      const oc = requireOpenCode()
      const ok = await oc.authRemove((message as any).providerId)
      reply({
        type: 'auth_removed_result',
        data: ok,
        providerId: (message as any).providerId,
      })
      return true
    }
    default:
      return false
  }
}
