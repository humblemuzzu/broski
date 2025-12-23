import { displayBanner, displayQRCode } from './qr'
import { getLocalIP, getTailscaleIP, isTailscaleConnected } from './network'
import { OpenCodeConnector } from './opencode'
import { createBridgeServer } from './server'

const DEFAULT_PORT = 18274

async function main() {
  const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json()
  const version = packageJson.version ?? '0.1.0'

  displayBanner()

  const port = Number(process.env.BROSKI_PORT ?? DEFAULT_PORT)
  const opencodeUrl = process.env.OPENCODE_BASE_URL ?? 'http://localhost:4096'

  const opencode = new OpenCodeConnector({ baseUrl: opencodeUrl })

  const opencodeRunning = await ensureOpenCodeRunning(opencode)
  if (!opencodeRunning) {
    console.log('⚠️  OpenCode is not running. Start it with: opencode serve')
  } else {
    console.log('✓ OpenCode detected')
  }

  const localIP = getLocalIP()
  const tailscaleIP = await getTailscaleIP()
  const tailscaleConnected = await isTailscaleConnected()

  if (!tailscaleConnected) {
    console.log('ℹ️  Tailscale not connected. Local network access only.')
  }

  const server = createBridgeServer({
    port,
    opencode,
    version,
    logger: (message) => console.log(message),
  })

  await opencode.startEventStream((event) => {
    console.log('[SDK Event]', JSON.stringify(event, null, 2))
    server.broadcast({ type: 'sdk_event', data: event })
  })

  displayQRCode({
    localIP,
    tailscaleIP,
    port,
    version,
  })

  console.log(`Bridge listening on port ${port}`)
}

async function ensureOpenCodeRunning(opencode: OpenCodeConnector): Promise<boolean> {
  const running = await opencode.isRunning()
  if (running) return true

  const shouldAutoStart = process.env.BROSKI_AUTOSTART_OPENCODE === '1'
  if (!shouldAutoStart) return false

  console.log('Starting OpenCode server...')
  return opencode.startServer()
}

void main()
