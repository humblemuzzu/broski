import type { WizardPrompter } from '../prompter'
import { displayQRCode } from '../../qr'
import { getLocalIP, getTailscaleIP, getHotspotIP, getTailscaleMagicDNS } from '../../network'
import { checkPortInUse } from '../../platform'
import type { BroskiConfig } from '../../config/schema'
import { brand, muted, bold, success, warning } from '../palette'
import packageMeta from '../../../package.json'

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
    version: packageMeta.version ?? '0.1.0',
    authToken: '', // Token not available in wizard context; QR is informational here
    tlsEnabled: config.security.tls,
    certSha256: null,
  })

  // Ask user to confirm they scanned the QR code
  const scanned = await prompter.confirm({
    message: 'Have you scanned the QR code with the Broski app?',
    initialValue: true,
  })

  if (scanned) {
    await prompter.note(
      `${success('✓')} ${bold('Pairing complete!')}\n\n` +
      `${muted('Your phone should now be connected to the bridge.')}\n` +
      `${muted('If the app shows "Disconnected", try these:')}\n\n` +
      `  ${bold('1.')} Ensure phone and computer are on the same Wi-Fi\n` +
      `  ${bold('2.')} Re-scan the QR code with ${brand('broski qr')}\n` +
      `  ${bold('3.')} Run ${brand('broski doctor')} for a full check`,
      'Connection',
    )
  } else {
    await prompter.note(
      `${warning('⚠')} ${bold('QR code not scanned yet')}\n\n` +
      `${muted('You can scan the QR code later:')}\n\n` +
      `  ${brand('broski qr')}          ${muted('— show QR code')}\n` +
      `  ${brand('broski qr --new-token')} ${muted('— generate a fresh QR')}\n\n` +
      `${muted('Troubleshooting:')}\n` +
      `  ${bold('•')} Make sure the Broski app is installed on your phone\n` +
      `  ${bold('•')} Both devices must be on the same network\n` +
      `  ${bold('•')} Run ${brand('broski troubleshoot')} for guided help`,
      'Pairing Skipped',
    )
  }
}
