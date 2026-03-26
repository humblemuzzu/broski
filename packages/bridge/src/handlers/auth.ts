/**
 * Auth session handler.
 * Extracted from server.ts — case: auth_session
 */

import type { ServerWebSocket } from 'bun'
import { createHash } from 'node:crypto'
import type { ServerMessage } from '../types'
import { refreshLocalLicenseFromCloud, type LocalLicenseState } from '../license'

type ReplyFn = (msg: any) => void

type ConnectionContext = {
  lastPongAt: number
  lastRttMs: number
  connectionType: 'local' | 'tailscale' | 'unknown'
  connectedAt: number
  cloudAuthed?: boolean
  cloudAppUserId?: string
  cloudEntitled?: boolean
  cloudStatus?: string
  cloudCheckedAt?: number
  cloudSessionToken?: string
  cloudSessionTokenHash?: string
  licenseExpSec?: number
  [key: string]: unknown
}

type EntitlementCacheEntry = {
  checkedAt: number
  appUserId: string
  entitled: boolean
  status?: string
}

export type AuthHandlerContext = {
  requireEntitlement: boolean
  convexHttpBaseUrl: string
  ENTITLEMENT_CACHE_TTL_MS: number
  OFFLINE_GRACE_MS: number
  entitlementCache: Map<string, EntitlementCacheEntry>
  contexts: Map<ServerWebSocket<unknown>, ConnectionContext>
  ws: ServerWebSocket<unknown>
  ctx: ConnectionContext | undefined
  clearCloudAuthTimer: (ws: ServerWebSocket<unknown>) => void
  log: (message: string) => void
  logUser: (message: string) => void
  logInfo: (message: string) => void
  toErrorMessage: (error: unknown) => string
  getLocalLicense: () => LocalLicenseState | null
  setLocalLicense: (license: LocalLicenseState) => void
}

export async function handleAuth(
  message: any,
  reply: ReplyFn,
  ctx: AuthHandlerContext,
): Promise<boolean> {
  if (message.type !== 'auth_session') return false

  const {
    requireEntitlement,
    convexHttpBaseUrl,
    ENTITLEMENT_CACHE_TTL_MS,
    OFFLINE_GRACE_MS,
    entitlementCache,
    contexts,
    ws,
    ctx: connCtx,
    clearCloudAuthTimer,
    log,
    logUser,
    logInfo,
    toErrorMessage,
    getLocalLicense,
    setLocalLicense,
  } = ctx

  const safeString = (v: unknown): string => (typeof v === 'string' ? v : '')

  log(`[auth_session] START - requireEntitlement=${requireEntitlement}`)
  const sessionToken = safeString(message.sessionToken).trim()
  if (sessionToken.length < 10 || sessionToken.length > 1024) {
    log(`[auth_session] REJECT - invalid token length: ${sessionToken.length}`)
    reply({
      type: 'error',
      message: 'Invalid sessionToken',
      code: 'INVALID_SESSION',
      requestId: message.requestId,
    })
    try {
      ws.close(4401, 'Invalid session')
    } catch {
      // ignore
    }
    return true
  }

  const tokenHash = createHash('sha256').update(sessionToken, 'utf8').digest('hex')
  const cached = entitlementCache.get(tokenHash)
  const nowSec = Math.floor(Date.now() / 1000)
  const localLicense = getLocalLicense()
  const hasValidLocalLicense = !!(
    requireEntitlement &&
    localLicense?.entitled &&
    localLicense.sessionTokenHash === tokenHash &&
    nowSec <= localLicense.exp
  )

  if (!convexHttpBaseUrl) {
    if (hasValidLocalLicense) {
      contexts.set(ws, {
        ...(connCtx ?? {
          lastPongAt: Date.now(),
          lastRttMs: 0,
          connectionType: 'unknown' as const,
          connectedAt: Date.now(),
        }),
        cloudAuthed: true,
        cloudAppUserId: localLicense!.appUserId,
        cloudEntitled: true,
        cloudStatus: localLicense!.status,
        cloudCheckedAt: Date.now(),
        cloudSessionToken: sessionToken,
        cloudSessionTokenHash: tokenHash,
        licenseExpSec: localLicense!.exp,
      })
      clearCloudAuthTimer(ws)
      reply({
        type: 'auth_session_ok',
        data: {
          appUserId: localLicense!.appUserId,
          entitled: true,
          ...(localLicense!.status ? { status: localLicense!.status } : {}),
        },
        requestId: message.requestId,
      })
      log('[CloudAuth] Convex base URL missing; accepted due to valid local license')
      return true
    }
    reply({
      type: 'error',
      message: 'Convex base URL not configured',
      code: 'CLOUD_AUTH_UNAVAILABLE',
      requestId: message.requestId,
    })
    try {
      ws.close(1011, 'Cloud auth unavailable')
    } catch {
      // ignore
    }
    return true
  }

  // Only use cache if entitled=true. If cache says NOT entitled, always do fresh check
  // (subscription might have just renewed, especially in sandbox where they renew every 5 min)
  if (cached && cached.entitled && Date.now() - cached.checkedAt <= ENTITLEMENT_CACHE_TTL_MS) {
    log(`[auth_session] CACHE HIT - entitled=${cached.entitled}, cacheAge=${Date.now() - cached.checkedAt}ms`)
    contexts.set(ws, {
      ...(connCtx ?? {
        lastPongAt: Date.now(),
        lastRttMs: 0,
        connectionType: 'unknown' as const,
        connectedAt: Date.now(),
      }),
      cloudAuthed: true,
      cloudAppUserId: cached.appUserId,
      cloudEntitled: cached.entitled,
      cloudStatus: cached.status,
      cloudCheckedAt: cached.checkedAt,
      cloudSessionToken: sessionToken,
      cloudSessionTokenHash: tokenHash,
      licenseExpSec: localLicense?.sessionTokenHash === tokenHash ? localLicense.exp : undefined,
    })
    clearCloudAuthTimer(ws)
    log(`[auth_session] CACHE HIT - SUCCESS, sending auth_session_ok`)
    reply({
      type: 'auth_session_ok',
      data: {
        appUserId: cached.appUserId,
        entitled: cached.entitled,
        ...(cached.status ? { status: cached.status } : {}),
      },
      requestId: message.requestId,
    })
    if (cached.entitled && convexHttpBaseUrl) {
      void (async () => {
        const refreshed = await refreshLocalLicenseFromCloud({
          convexHttpBaseUrl,
          sessionToken,
        }).catch(() => null)
        if (refreshed && refreshed.ok && refreshed.state.entitled) {
          setLocalLicense(refreshed.state)
        }
      })()
    }
    return true
  }

  try {
    const refreshed = await refreshLocalLicenseFromCloud({
      convexHttpBaseUrl,
      sessionToken,
    })

    if (!refreshed.ok) {
      if (refreshed.status === 401) {
        reply({
          type: 'error',
          message: 'Invalid session',
          code: 'INVALID_SESSION',
          requestId: message.requestId,
        })
        try {
          ws.close(4401, 'Invalid session')
        } catch {
          // ignore
        }
        return true
      }
      if (refreshed.status === 403) {
        reply({
          type: 'error',
          message: refreshed.message,
          code: refreshed.code || 'LICENSE_DENIED',
          requestId: message.requestId,
        })
        try {
          ws.close(4403, 'License required')
        } catch {
          // ignore
        }
        return true
      }
      reply({
        type: 'error',
        message: refreshed.message,
        code: refreshed.code || 'CLOUD_AUTH_FAILED',
        requestId: message.requestId,
      })
      try {
        ws.close(1011, 'Cloud auth failed')
      } catch {
        // ignore
      }
      return true
    }

    setLocalLicense(refreshed.state)
    const record = {
      checkedAt: Date.now(),
      appUserId: refreshed.state.appUserId,
      entitled: refreshed.state.entitled,
      ...(refreshed.state.status ? { status: refreshed.state.status } : {}),
    }
    entitlementCache.set(tokenHash, record)

    log(`[auth_session] FRESH CHECK - entitled=${refreshed.state.entitled}, appUserId=${refreshed.state.appUserId}`)
    // FIX: Check entitlement BEFORE sending auth_session_ok to avoid
    // sending success then immediately closing (causes reconnect loops).
    if (requireEntitlement && !refreshed.state.entitled) {
      logUser(`Session rejected: device not entitled`)
      logInfo(`[auth_session] FRESH CHECK - NOT ENTITLED, closing connection`)
      reply({
        type: 'error',
        message: 'LICENSE_REQUIRED',
        code: 'LICENSE_REQUIRED',
        requestId: message.requestId,
      })
      try {
        ws.close(4403, 'License required')
      } catch {
        // ignore
      }
      return true
    }

    contexts.set(ws, {
      ...(connCtx ?? {
        lastPongAt: Date.now(),
        lastRttMs: 0,
        connectionType: 'unknown' as const,
        connectedAt: Date.now(),
      }),
      cloudAuthed: true,
      cloudAppUserId: refreshed.state.appUserId,
      cloudEntitled: refreshed.state.entitled,
      cloudStatus: refreshed.state.status,
      cloudCheckedAt: record.checkedAt,
      cloudSessionToken: sessionToken,
      cloudSessionTokenHash: tokenHash,
      licenseExpSec: refreshed.state.exp,
    })
    clearCloudAuthTimer(ws)
    reply({
      type: 'auth_session_ok',
      data: {
        appUserId: refreshed.state.appUserId,
        entitled: refreshed.state.entitled,
        ...(refreshed.state.status ? { status: refreshed.state.status } : {}),
      },
      requestId: message.requestId,
    })
  } catch (error) {
    // If a valid local license exists, do not hard-fail auth_session when the
    // cloud is unreachable (offline / transient DNS issues). We'll refresh on
    // the next successful online handshake.
    if (hasValidLocalLicense) {
      contexts.set(ws, {
        ...(connCtx ?? {
          lastPongAt: Date.now(),
          lastRttMs: 0,
          connectionType: 'unknown' as const,
          connectedAt: Date.now(),
        }),
        cloudAuthed: true,
        cloudAppUserId: localLicense!.appUserId,
        cloudEntitled: true,
        cloudStatus: localLicense!.status,
        cloudCheckedAt: Date.now(),
        cloudSessionToken: sessionToken,
        cloudSessionTokenHash: tokenHash,
        licenseExpSec: localLicense!.exp,
      })
      clearCloudAuthTimer(ws)
      reply({
        type: 'auth_session_ok',
        data: {
          appUserId: localLicense!.appUserId,
          entitled: true,
          ...(localLicense!.status ? { status: localLicense!.status } : {}),
        },
        requestId: message.requestId,
      })
      log('[CloudAuth] Cloud unreachable; accepted due to valid local license')
      return true
    }

    // Offline grace: if we have a recent "entitled" cache, keep working.
    if (cached && cached.entitled && Date.now() - cached.checkedAt <= OFFLINE_GRACE_MS) {
      contexts.set(ws, {
        ...(connCtx ?? {
          lastPongAt: Date.now(),
          lastRttMs: 0,
          connectionType: 'unknown' as const,
          connectedAt: Date.now(),
        }),
        cloudAuthed: true,
        cloudAppUserId: cached.appUserId,
        cloudEntitled: cached.entitled,
        cloudStatus: cached.status,
        cloudCheckedAt: cached.checkedAt,
        cloudSessionToken: sessionToken,
        cloudSessionTokenHash: tokenHash,
        licenseExpSec: localLicense?.sessionTokenHash === tokenHash ? localLicense.exp : undefined,
      })
      clearCloudAuthTimer(ws)
      reply({
        type: 'auth_session_ok',
        data: {
          appUserId: cached.appUserId,
          entitled: cached.entitled,
          ...(cached.status ? { status: cached.status } : {}),
        },
        requestId: message.requestId,
      })
      log(`[CloudAuth] Offline grace applied (cache age ${Date.now() - cached.checkedAt}ms)`)
      return true
    }

    reply({
      type: 'error',
      message: 'Cloud auth failed',
      code: 'CLOUD_AUTH_FAILED',
      requestId: message.requestId,
    })
    try {
      ws.close(1011, 'Cloud auth failed')
    } catch {
      // ignore
    }
    log(`[CloudAuth] Failed: ${toErrorMessage(error)}`)
  }

  return true
}
