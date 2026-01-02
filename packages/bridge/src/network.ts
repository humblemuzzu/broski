import { networkInterfaces } from 'os'
import { $ } from 'bun'

// Tailscale CLI path varies by platform
const TAILSCALE_CLI = process.platform === 'darwin'
  ? '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  : 'tailscale'

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
    const result = await $`${TAILSCALE_CLI} ip -4 2>/dev/null`.quiet()
    const ip = result.text().trim()
    if (ip.startsWith('100.')) return ip
    return null
  } catch {
    return null
  }
}

export async function isTailscaleConnected(): Promise<boolean> {
  try {
    const result = await $`${TAILSCALE_CLI} status 2>/dev/null`.quiet()
    return !result.text().includes('Tailscale is stopped')
  } catch {
    return false
  }
}

export async function getTailscaleMagicDNS(): Promise<string | null> {
  try {
    // Get the current hostname from Tailscale status JSON
    const result = await $`${TAILSCALE_CLI} status --json 2>/dev/null`.quiet()
    const status = JSON.parse(result.text())

    // The current device's MagicDNS name
    const self = status.Self
    if (self && self.DNSName) {
      // DNSName includes trailing dot, remove it
      return self.DNSName.replace(/\.$/, '')
    }

    return null
  } catch {
    return null
  }
}

export async function getTailnetName(): Promise<string | null> {
  try {
    const result = await $`${TAILSCALE_CLI} status --json 2>/dev/null`.quiet()
    const status = JSON.parse(result.text())

    // Get tailnet name from MagicDNSSuffix
    // e.g., "tailnet-name.ts.net" → "tailnet-name"
    const suffix = status.MagicDNSSuffix
    if (suffix) {
      return suffix.replace(/\.ts\.net\.?$/, '')
    }

    return null
  } catch {
    return null
  }
}

// Hotspot detection for mobile tethering scenarios
// iPhone hotspot: typically uses 172.20.10.x range
// Android hotspot: typically uses 192.168.43.x or 192.168.44.x range
export function getHotspotIP(): string | null {
  const interfaces = networkInterfaces()

  // First, look for IPs in known hotspot ranges
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.internal || iface.family !== 'IPv4') continue

      // iPhone hotspot range
      if (iface.address.startsWith('172.20.10.')) {
        return iface.address
      }

      // Android hotspot ranges
      if (iface.address.startsWith('192.168.43.') || iface.address.startsWith('192.168.44.')) {
        return iface.address
      }
    }
  }

  // Second, look for hotspot interface names
  const hotspotInterfacePatterns = ['en1', 'en2', 'bridge100', 'bridge', 'utun', 'apd']
  for (const name of Object.keys(interfaces)) {
    const ifaceName = name.toLowerCase()
    if (hotspotInterfacePatterns.some(pattern => ifaceName.includes(pattern))) {
      for (const iface of interfaces[name] || []) {
        if (!iface.internal && iface.family === 'IPv4') {
          return iface.address
        }
      }
    }
  }

  return null
}

