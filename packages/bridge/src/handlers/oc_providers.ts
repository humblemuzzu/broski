import type { ClientMessage, ServerMessage } from '../types'
import type { Auth } from '@opencode-ai/sdk/v2'
import { mapOpenCodeProvidersToRuntimeModels } from '../runtime/opencode-runtime-read-models'

type Reply = (message: ServerMessage) => void

type OpenCodeProviderLike = {
  listProviders: () => Promise<any>
  listAllProviders: (dir?: string) => Promise<any>
  getProviderAuth: (dir?: string) => Promise<any>
  providerOauthAuthorize: (
    id: string,
    method: number,
    dir?: string,
  ) => Promise<any>
  providerOauthCallback: (
    id: string,
    method: number,
    code?: string,
    dir?: string,
  ) => Promise<boolean>
  authSet: (providerId: string, auth: Auth) => Promise<boolean>
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
        message.providerId,
        message.method,
        message.projectPath,
      )
      reply({
        type: 'provider_oauth_authorized',
        data,
        providerId: message.providerId,
      })
      return true
    }
    case 'provider_oauth_callback': {
      const oc = requireOpenCode()
      const ok = await oc.providerOauthCallback(
        message.providerId,
        message.method,
        message.code,
        message.projectPath,
      )
      reply({
        type: 'provider_oauth_callback',
        data: ok,
        providerId: message.providerId,
      })
      return true
    }
    case 'auth_set': {
      const oc = requireOpenCode()
      const ok = await oc.authSet(
        message.providerId,
        message.auth as Auth,
      )
      reply({
        type: 'auth_set_result',
        data: ok,
        providerId: message.providerId,
      })
      return true
    }
    case 'auth_remove': {
      const oc = requireOpenCode()
      const ok = await oc.authRemove(message.providerId)
      reply({
        type: 'auth_removed_result',
        data: ok,
        providerId: message.providerId,
      })
      return true
    }
    default:
      return false
  }
}
