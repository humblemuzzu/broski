import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export type TlsMaterial = {
  keyPath: string
  certPath: string
  certSha256: string
}

const TLS_DIR = resolve(homedir(), '.broski', 'tls')
const TLS_KEY_PATH = resolve(TLS_DIR, 'server.key.pem')
const TLS_CERT_PATH = resolve(TLS_DIR, 'server.cert.pem')

function pemToDer(pem: string): Buffer {
  const b64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
  return Buffer.from(b64, 'base64')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

function isTruthyEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  const v = value.trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  return fallback
}

async function generateSelfSignedCert(): Promise<void> {
  // We intentionally shell out to OpenSSL instead of adding heavy JS/X509 deps.
  // OpenSSL exists on macOS + most Linux distros; if it doesn't, we'll fail fast
  // and the user can set BROSKI_TLS=0 as an explicit insecure escape hatch.
  const openssl = Bun.which('openssl') ?? 'openssl'
  const validityDays = Number(process.env.BROSKI_TLS_CERT_DAYS ?? '365') || 365

  await mkdir(dirname(TLS_KEY_PATH), { recursive: true })

  // Create a new private key + self-signed cert in one shot.
  // - CN is informational; the app pins the cert fingerprint (not hostname).
  const res = Bun.spawnSync({
    cmd: [
      openssl,
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=broski',
      '-days',
      String(validityDays),
      '-keyout',
      TLS_KEY_PATH,
      '-out',
      TLS_CERT_PATH,
    ],
    stdout: 'pipe',
    stderr: 'pipe',
  })

  if (res.exitCode !== 0) {
    const stderr = (res.stderr?.toString() ?? '').trim()
    const stdout = (res.stdout?.toString() ?? '').trim()
    throw new Error(`Failed to generate TLS cert via OpenSSL. ${stderr || stdout || 'unknown error'}`)
  }

  // Tighten key permissions (best-effort; platform-dependent).
  try {
    await writeFile(TLS_KEY_PATH, await readFile(TLS_KEY_PATH), { mode: 0o600 })
  } catch {
    // ignore
  }
  try {
    await writeFile(TLS_CERT_PATH, await readFile(TLS_CERT_PATH), { mode: 0o644 })
  } catch {
    // ignore
  }
}

export function isTlsEnabledByEnv(): boolean {
  return isTruthyEnv(process.env.BROSKI_TLS, true)
}

export async function ensureTlsMaterial(): Promise<TlsMaterial> {
  const hasKey = await fileExists(TLS_KEY_PATH)
  const hasCert = await fileExists(TLS_CERT_PATH)

  if (!hasKey || !hasCert) {
    await generateSelfSignedCert()
  }

  const certPem = await readFile(TLS_CERT_PATH, 'utf-8')
  const der = pemToDer(certPem)
  const certSha256 = createHash('sha256').update(der).digest('base64url')

  return {
    keyPath: TLS_KEY_PATH,
    certPath: TLS_CERT_PATH,
    certSha256,
  }
}

