import { createFallbackLicenseCrypto, type LicenseCrypto } from './fallback'
import { loadNativeLicense } from './native'
import { loadStoredLicense, saveStoredLicense } from './store'
export { verifyBinaryIntegrity, startPeriodicIntegrityCheck, stopPeriodicIntegrityCheck, type IntegrityResult } from './integrity'

export type LocalLicenseState = {
  entitled: boolean
  appUserId: string
  sessionTokenHash: string
  status?: string
  exp: number
  iat: number
  machineIdHash: string
}

let cachedCrypto: LicenseCrypto | null = null

export function getLicenseCrypto(): LicenseCrypto {
  // Prefer native library when present (harder to tamper with / hide keys), but
  // always fall back to a pure-TS implementation so licensing still works even
  // when the native lib is missing.
  if (cachedCrypto) return cachedCrypto
  cachedCrypto = (loadNativeLicense() ?? createFallbackLicenseCrypto()) as LicenseCrypto
  return cachedCrypto
}

function parseLicenseClaims(params: {
  claimsJson: string
  machineIdHash: string
}): LocalLicenseState | null {
  try {
    const claims = JSON.parse(params.claimsJson) as any
    const appUserId = String(claims.appUserId ?? '')
    const sessionTokenHash = String(claims.sessionTokenHash ?? '')
    const exp = Number(claims.exp ?? 0)
    const iat = Number(claims.iat ?? 0)
    const status = typeof claims.status === 'string' ? claims.status : undefined
    const entitled = !!claims.entitled
    if (!appUserId || !sessionTokenHash || !Number.isFinite(exp) || exp <= 0) return null
    return { entitled, appUserId, sessionTokenHash, exp, iat, status, machineIdHash: params.machineIdHash }
  } catch {
    return null
  }
}

export async function loadLocalLicenseState(): Promise<LocalLicenseState | null> {
  const crypto = getLicenseCrypto()

  const stored = await loadStoredLicense()
  if (!stored) return null

  const machineIdHash = crypto.machineIdHash()
  if (!machineIdHash) return null

  const jws = crypto.decryptJws(stored.enc, machineIdHash)
  if (!jws) return null

  // Verify before trusting any claims or enabling offline grace.
  if (!crypto.verifyJws(jws, machineIdHash)) return null

  const claimsJson = crypto.claimsJson(jws, machineIdHash)
  if (!claimsJson) return null
  return parseLicenseClaims({ claimsJson, machineIdHash })
}

export async function refreshLocalLicenseFromCloud(params: {
  convexHttpBaseUrl: string
  sessionToken: string
}): Promise<
  | { ok: true; state: LocalLicenseState }
  | { ok: false; code: string; message: string; status: number }
> {
  const crypto = getLicenseCrypto()
  const machineIdHash = crypto.machineIdHash()
  if (!machineIdHash) return { ok: false, code: 'MACHINE_ID_UNAVAILABLE', message: 'Machine id unavailable', status: 500 }

  const res = await fetch(`${params.convexHttpBaseUrl}/me/license`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ machineIdHash }),
    signal: AbortSignal.timeout(10_000),
  })

  const json = await res.json().catch(() => null) as any
  if (!res.ok || !json || json.ok !== true) {
    const code = String(json?.errorCode ?? json?.code ?? json?.error ?? 'CLOUD_AUTH_FAILED')
    const message = String(json?.errorMessage ?? json?.message ?? json?.error ?? 'Cloud auth failed')
    return { ok: false, code, message, status: res.status }
  }

  const licenseJws = String(json.license ?? '')
  if (!licenseJws) return { ok: false, code: 'INVALID_LICENSE', message: 'Missing license', status: 500 }

  // Verify before we persist.
  if (!crypto.verifyJws(licenseJws, machineIdHash)) {
    return { ok: false, code: 'INVALID_LICENSE', message: 'Invalid license signature', status: 500 }
  }
  const claimsJson = crypto.claimsJson(licenseJws, machineIdHash)
  if (!claimsJson) return { ok: false, code: 'INVALID_LICENSE', message: 'Invalid license claims', status: 500 }

  const enc = crypto.encryptJws(licenseJws, machineIdHash)
  if (!enc) return { ok: false, code: 'LICENSE_ENCRYPT_FAILED', message: 'Failed to encrypt license', status: 500 }
  await saveStoredLicense(enc)

  const state = parseLicenseClaims({ claimsJson, machineIdHash })
  if (!state) return { ok: false, code: 'INVALID_LICENSE', message: 'Invalid license payload', status: 500 }
  return { ok: true, state }
}
