import type { WizardPrompter } from '../prompter'
import { displayQRCode } from '../../qr'
import { getLocalIP, getTailscaleIP, getHotspotIP, getTailscaleMagicDNS } from '../../network'
import { checkPortInUse } from '../../platform'
import type { BroskiConfig } from '../../config/schema'
import { brand, muted, bold, success, warning } from '../palette'

export async function runConnectivityStep(
  prompter: WizardPrompter,
  config: BroskiConfig,
): Promise<void> {
  const port = config.network.port
  const isRunning = await checkPortInUse(port)

  if (!isRunning) {
    await prompter.note(
      `${warning('⚠')} Bridge is not running on port ${bold(String(port))}.\n\n` +
      `Start the bridge first, then scan the QR code:\n` +
      `  ${brand('broski')}          ${muted('— start bridge')}\n` +
      `  ${brand('broski qr')}       ${muted('— show QR code')}`,
      'Pairing',
    )
    return
  }

  // Bridge is running — show QR code
  const localIP = getLocalIP()
  const tailscaleIP = await getTailscaleIP()
  const hotspotIP = getHotspotIP()
  const magicDNS = await getTailscaleMagicDNS()

  await prompter.note(
    `${success('✓')} Bridge is running on port ${bold(String(port))}.\n\n` +
    `${muted('Scan the QR code below with the Broski app.')}`,
    'Pairing',
  )

  // Display QR code using existing utility
  // Note: displayQRCode writes directly to console — this is acceptable
  // since it's the final informational step
  displayQRCode({
    localIP,
    tailscaleIP,
    magicDNS,
    funnelURL: null,
    hotspotIP,
    port,
    version: '0.1.0',
    authToken: '', // Token not available in wizard context; QR is informational here
    tlsEnabled: config.security.tls,
    certSha256: null,
  })
}
