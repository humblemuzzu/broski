import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, createHash, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto'

const ENC_SALT = Buffer.from('broski-license-v1', 'utf8')
const ENC_INFO = Buffer.from('broski-license-aes256gcm', 'utf8')

// Public key (SPKI DER) base64url. Safe to ship.
// Stored as chunks to avoid a single plaintext constant in the binary.
const LICENSE_PUBLIC_KEY_SPKI_DER_B64URL = [
  'MCowBQYDK2VwAyEAmJztoQK7jSP-KJAmaNn30hizv9NzOhc-QNbUMO1kWgc',
].join('')

const LICENSE_JWS_TYP = 'BRSK-LICENSE'
const LICENSE_JWS_KID = 'v1'
const CLOCK_SKEW_SEC = 30

function base64UrlToBuffer(s: string): Buffer {
  return Buffer.from(s, 'base64url')
}

function sha256Base64Url(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('base64url')
}

function readMachineSource(): string {
  if (process.platform === 'linux') {
    for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const s = readFileSync(p, 'utf8').trim()
        if (s) return s
      } catch {
        // ignore
      }
    }
  }

  if (process.platform === 'darwin') {
    try {
      const out = execSync('/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      })
      for (const line of out.split('\n')) {
        if (!line.includes('IOPlatformUUID')) continue
        const idx = line.indexOf('=')
        if (idx === -1) continue
        const v = line.slice(idx + 1).trim().replaceAll('"', '')
        if (v) return v
      }
    } catch {
      // ignore
    }
  }

  if (process.platform === 'win32') {
    try {
      const out = execSync('wmic csproduct get uuid', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      })
      for (const line of out.split('\n')) {
        const t = line.trim()
        if (!t || t.toLowerCase() === 'uuid') continue
        return t
      }
    } catch {
      // ignore
    }
  }

  const host = process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown-host'
  return `${host}:${process.platform}:${process.arch}`
}

function deriveKey(machineIdHash: string): Buffer {
  // hkdfSync returns ArrayBuffer on newer Node; cast to Buffer.
  const okm = hkdfSync('sha256', Buffer.from(machineIdHash, 'utf8'), ENC_SALT, ENC_INFO, 32)
  return Buffer.isBuffer(okm) ? okm : Buffer.from(okm)
}

export type LicenseCrypto = {
  machineIdHash: () => string
  encryptJws: (jws: string, machineIdHash: string) => string
  decryptJws: (enc: string, machineIdHash: string) => string
  verifyJws: (jws: string, machineIdHash: string) => boolean
  claimsJson: (jws: string, machineIdHash: string) => string
  verifyCodesign: (exePath: string) => boolean
}

export function createFallbackLicenseCrypto(): LicenseCrypto {
  const pubDer = base64UrlToBuffer(LICENSE_PUBLIC_KEY_SPKI_DER_B64URL)
  const pubKey = createPublicKey({ key: pubDer, format: 'der', type: 'spki' })

  const verifyJwsImpl = (jws: string, machineIdHash: string): boolean => {
    try {
      const parts = jws.split('.')
      if (parts.length !== 3) return false
      const [h, p, s] = parts
      const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))
      if (header?.alg !== 'EdDSA') return false
      if (header?.typ !== LICENSE_JWS_TYP) return false
      if (header?.kid !== LICENSE_JWS_KID) return false
      const signingInput = Buffer.from(`${h}.${p}`, 'utf8')
      const sig = Buffer.from(s, 'base64url')
      const ok = verify(null, signingInput, pubKey, sig)
      if (!ok) return false
      const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
      if (payload?.machineIdHash !== machineIdHash) return false
      const exp = Number(payload?.exp ?? 0)
      const now = Math.floor(Date.now() / 1000)
      return Number.isFinite(exp) && now <= exp + CLOCK_SKEW_SEC
    } catch {
      return false
    }
  }

  return {
    machineIdHash: () => sha256Base64Url(readMachineSource()),

    encryptJws: (jws, machineIdHash) => {
      const key = deriveKey(machineIdHash)
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      const ciphertext = Buffer.concat([cipher.update(jws, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return Buffer.concat([nonce, ciphertext, tag]).toString('base64url')
    },

    decryptJws: (enc, machineIdHash) => {
      try {
        const raw = Buffer.from(enc, 'base64url')
        if (raw.length < 12 + 16) return ''
        const nonce = raw.subarray(0, 12)
        const tag = raw.subarray(raw.length - 16)
        const ciphertext = raw.subarray(12, raw.length - 16)
        const key = deriveKey(machineIdHash)
        const decipher = createDecipheriv('aes-256-gcm', key, nonce)
        decipher.setAuthTag(tag)
        const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
        return plain.toString('utf8')
      } catch {
        return ''
      }
    },

    verifyJws: verifyJwsImpl,

    claimsJson: (jws, machineIdHash) => {
      try {
        if (!jws) return ''
        if (!jws.includes('.')) return ''
        if (!verifyJwsImpl(jws, machineIdHash)) return ''
        const parts = jws.split('.')
        if (parts.length !== 3) return ''
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
        if (payload?.machineIdHash !== machineIdHash) return ''
        return JSON.stringify(payload)
      } catch {
        return ''
      }
    },

    verifyCodesign: (exePath) => {
      if (process.platform !== 'darwin') return true
      try {
        execFileSync(
          '/usr/bin/codesign',
          ['--verify', '--deep', '--strict', '--verbose=0', exePath],
          { stdio: 'ignore', timeout: 5000 },
        )
        return true
      } catch {
        return false
      }
    },
  }
}
