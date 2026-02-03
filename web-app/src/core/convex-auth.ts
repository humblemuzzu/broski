import { getConvexHttpBaseUrl } from "@/core/cloud"

export type ConvexAuthResult =
  | {
      ok: true
      sessionToken: string
      sessionExpiresAtMs?: number
      user?: unknown
    }
  | { ok: false; error: string }

export async function exchangeGoogleIdTokenForSession(params: {
  idToken: string
  device?: { platform?: string; deviceId?: string; appVersion?: string }
}): Promise<ConvexAuthResult> {
  try {
    const base = getConvexHttpBaseUrl()
    const res = await fetch(`${base}/auth/google`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: params.idToken, device: params.device }),
    })
    const json = (await res.json().catch(() => null)) as any
    if (!res.ok || !json?.ok) {
      return { ok: false, error: String(json?.error ?? "Auth failed") }
    }
    const sessionToken =
      typeof json.sessionToken === "string" ? json.sessionToken : ""
    if (!sessionToken) return { ok: false, error: "Missing sessionToken" }
    return {
      ok: true,
      sessionToken,
      sessionExpiresAtMs:
        typeof json.sessionExpiresAtMs === "number"
          ? json.sessionExpiresAtMs
          : undefined,
      user: json.user,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

