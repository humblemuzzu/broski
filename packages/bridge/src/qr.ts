// @ts-expect-error -- qrcode-terminal has no type declarations
import qrcode from 'qrcode-terminal'

export interface ConnectionInfo {
  localIP: string | null
  tailscaleIP: string | null
  magicDNS: string | null
  funnelURL: string | null
  hotspotIP: string | null
  port: number
  version: string
  authToken: string
  tlsEnabled?: boolean
  certSha256?: string | null
}

export function displayQRCode(info: ConnectionInfo): void {
  const data = JSON.stringify({
    l: info.localIP,
    t: info.tailscaleIP,
    m: info.magicDNS,
    f: info.funnelURL,
    h: info.hotspotIP,
    p: info.port,
    v: info.version,
    a: info.authToken,
    s: info.tlsEnabled ? 1 : 0,
    c: info.certSha256 ?? null,
  })

  console.log('\n')
  console.log('  Scan this QR code with the Broski app:')
  console.log('')

  qrcode.generate(data, { small: true }, (qr: string) => {
    const indented = qr
      .split('\n')
      .map((line: string) => `    ${line}`)
      .join('\n')
    console.log(indented)
  })

  console.log('')
  console.log('  Or connect manually:')
  const scheme = info.tlsEnabled ? 'wss' : 'ws'
  if (info.localIP) {
    console.log(`  - Local:     ${scheme}://${info.localIP}:${info.port}`)
  }
  if (info.hotspotIP) {
    console.log(`  - Hotspot:   ${scheme}://${info.hotspotIP}:${info.port}`)
  }
  if (info.tailscaleIP) {
    console.log(`  - Tailscale: ${scheme}://${info.tailscaleIP}:${info.port}`)
  }
  if (info.magicDNS) {
    console.log(`  - MagicDNS:  ${scheme}://${info.magicDNS}:${info.port}`)
  }
  if (info.funnelURL) {
    console.log(`  - Public:    ${info.funnelURL}`)
  }
  console.log('')
}

export function displayBanner(): void {
  console.log(`
  ╔══════════════════════════════════════════════════════════╗
  ║                                                          ║
  ║   ██████╗ ██████╗  ██████╗ ███████╗██╗  ██╗██╗           ║
  ║   ██╔══██╗██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██║           ║
  ║   ██████╔╝██████╔╝██║   ██║███████╗█████╔╝ ██║           ║
  ║   ██╔══██╗██╔══██╗██║   ██║╚════██║██╔═██╗ ██║           ║
  ║   ██████╔╝██║  ██║╚██████╔╝███████║██║  ██╗██║           ║
  ║   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝           ║
  ║                                                          ║
  ║              Vibe code from anywhere.                    ║
  ║                                                          ║
  ╚══════════════════════════════════════════════════════════╝
  `)
}
