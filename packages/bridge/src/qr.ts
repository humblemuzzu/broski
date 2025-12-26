import qrcode from 'qrcode-terminal'

export interface ConnectionInfo {
  localIP: string | null
  tailscaleIP: string | null
  magicDNS: string | null
  funnelURL: string | null
  port: number
  version: string
}

export function displayQRCode(info: ConnectionInfo): void {
  const data = JSON.stringify({
    l: info.localIP,
    t: info.tailscaleIP,
    m: info.magicDNS,
    f: info.funnelURL,
    p: info.port,
    v: info.version,
  })

  console.log('\n')
  console.log('  Scan this QR code with the Broski app:')
  console.log('')

  qrcode.generate(data, { small: true }, (qr) => {
    const indented = qr
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')
    console.log(indented)
  })

  console.log('')
  console.log('  Or connect manually:')
  if (info.localIP) {
    console.log(`  - Local:     ws://${info.localIP}:${info.port}`)
  }
  if (info.tailscaleIP) {
    console.log(`  - Tailscale: ws://${info.tailscaleIP}:${info.port}`)
  }
  if (info.magicDNS) {
    console.log(`  - MagicDNS:  ws://${info.magicDNS}:${info.port}`)
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
  ║                Broski Bridge (Personal MVP)              ║
  ║                                                          ║
  ╚══════════════════════════════════════════════════════════╝
  `)
}
