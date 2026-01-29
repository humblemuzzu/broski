import { $ } from 'bun'
import { getTailscaleBinaryPath } from './platform'

const TAILSCALE_BIN = getTailscaleBinaryPath()

export interface FunnelStatus {
  enabled: boolean
  url: string | null
  port: number | null
}

export async function getFunnelStatus(): Promise<FunnelStatus> {
  try {
    const result = await $`${TAILSCALE_BIN} funnel status --json`.quiet()
    const status = JSON.parse(result.text())

    const services = status.Services ?? {}
    const funnelEntry = Object.entries(services).find(
      ([_, s]: [string, any]) => s.Funnel === true
    )

    if (funnelEntry) {
      const [portStr, service] = funnelEntry as [string, any]
      return {
        enabled: true,
        url: service.URL ?? null,
        port: parseInt(portStr, 10) || null,
      }
    }

    return { enabled: false, url: null, port: null }
  } catch {
    return { enabled: false, url: null, port: null }
  }
}

/**
 * Requires Funnel to be enabled in Tailscale admin console first.
 * See: https://tailscale.com/kb/1223/tailscale-funnel
 */
export async function enableFunnel(port: number): Promise<{ success: boolean; url: string | null; error?: string }> {
  try {
    await $`${TAILSCALE_BIN} funnel ${port}`.quiet()
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const status = await getFunnelStatus()
    
    if (status.enabled && status.url) {
      return { success: true, url: status.url }
    }

    return { 
      success: false, 
      url: null, 
      error: 'Funnel command succeeded but status shows not enabled. Check Tailscale admin console.' 
    }
  } catch (error: any) {
    const message = error?.message ?? String(error)
    
    if (message.includes('not enabled') || message.includes('admin console')) {
      return {
        success: false,
        url: null,
        error: 'Tailscale Funnel is not enabled. Enable it in your Tailscale admin console first.',
      }
    }

    return {
      success: false,
      url: null,
      error: `Failed to enable Funnel: ${message}`,
    }
  }
}

export async function disableFunnel(port: number): Promise<boolean> {
  try {
    await $`${TAILSCALE_BIN} funnel off ${port}`.quiet()
    return true
  } catch {
    return false
  }
}

export async function isFunnelAvailable(): Promise<boolean> {
  try {
    await $`${TAILSCALE_BIN} funnel --help`.quiet()
    return true
  } catch {
    return false
  }
}
