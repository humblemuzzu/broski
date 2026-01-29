import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { generateSelfSignedCertificate } from './platform'

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
  const validityDays = Number(process.env.BROSKI_TLS_CERT_DAYS ?? '365') || 365
  await generateSelfSignedCertificate({
    commonName: 'broski',
    validityDays,
    keyPath: TLS_KEY_PATH,
    certPath: TLS_CERT_PATH,
  })
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

