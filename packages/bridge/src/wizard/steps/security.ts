import type { WizardPrompter } from '../prompter'
import { ensureTlsMaterial, isTlsEnabledByEnv } from '../../tls'
import { success, muted, bold, brand, warning } from '../palette'

export type SecurityResult = {
  tls: boolean
  tokenTtlDays: number
}

export async function runSecurityStep(
  prompter: WizardPrompter,
  options: { isQuick: boolean },
): Promise<SecurityResult> {
  if (options.isQuick) {
    // Auto-enable TLS, auto-generate cert
    const spin = prompter.spinner()
    spin.start('Setting up TLS encryption...')

    try {
      const material = await ensureTlsMaterial()
      const fingerprint = material.certSha256.substring(0, 16)
      spin.stop(success('TLS certificate ready'))

      await prompter.note(
        `  ${bold('TLS:')}        ${success('Enabled')}\n` +
        `  ${bold('Token TTL:')}  7 days\n` +
        `  ${bold('Cert SHA:')}   ${brand(fingerprint)}${muted('...')}`,
        'Security',
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      spin.stop(`TLS setup failed: ${msg}`)
      await prompter.note(
        `${muted('TLS will be retried when the bridge starts.')}\n` +
        `${muted('If this persists, run:')} ${brand('broski doctor')}`,
        'TLS Warning',
      )
    }

    return { tls: true, tokenTtlDays: 7 }
  }

  // Advanced mode
  const tlsDefault = isTlsEnabledByEnv()
  const enableTls = await prompter.confirm({
    message: 'Enable TLS encryption? (strongly recommended)',
    initialValue: tlsDefault,
  })

  if (enableTls) {
    const spin = prompter.spinner()
    spin.start('Generating TLS certificate...')
    try {
      const material = await ensureTlsMaterial()
      const fingerprint = material.certSha256.substring(0, 16)
      spin.stop(`${success('Certificate ready')} ${muted(`SHA: ${fingerprint}...`)}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      spin.stop(`TLS setup failed: ${msg}`)
      await prompter.note(
        `${muted('TLS will be retried when the bridge starts.')}\n` +
        `${muted('If this persists, run:')} ${brand('broski doctor')}`,
        'TLS Warning',
      )
    }
  }

  const ttl = await prompter.select<number>({
    message: 'Auth token expiration:',
    options: [
      { value: 7, label: '7 days', hint: 'recommended' },
      { value: 14, label: '14 days' },
      { value: 30, label: '30 days' },
      { value: 90, label: '90 days', hint: 'less secure' },
    ],
    initialValue: 7,
  })

  return { tls: enableTls, tokenTtlDays: ttl }
}
