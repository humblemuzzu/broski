import { networkInterfaces } from 'os'
import { $ } from 'bun'

export function getLocalIP(): string | null {
  const interfaces = networkInterfaces()

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.internal || iface.family !== 'IPv4') continue
      if (name === 'en0' || name === 'eth0') return iface.address
    }
  }

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!iface.internal && iface.family === 'IPv4') {
        return iface.address
      }
    }
  }

  return null
}

export async function getTailscaleIP(): Promise<string | null> {
  try {
    const result = await $`tailscale ip -4 2>/dev/null`.quiet()
    const ip = result.text().trim()
    if (ip.startsWith('100.')) return ip
    return null
  } catch {
    return null
  }
}

export async function isTailscaleConnected(): Promise<boolean> {
  try {
    const result = await $`tailscale status 2>/dev/null`.quiet()
    return !result.text().includes('Tailscale is stopped')
  } catch {
    return false
  }
}
