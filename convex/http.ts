import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { CompactSign, createRemoteJWKSet, importPKCS8, jwtVerify } from "jose";

const http = httpRouter();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(message: string, status = 400) {
  return json({ ok: false, error: message }, status);
}

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlToBase64(b64url: string): string {
  const normalized = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return normalized + "=".repeat(padLen);
}

function derB64UrlToPem(derB64Url: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
  const b64 = base64UrlToBase64(derB64Url);
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

function getMaxMachines(): number {
  const raw = process.env.BROSKI_MAX_MACHINES ?? "3";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 3;
  return Math.min(Math.max(Math.floor(n), 1), 10);
}

async function hmacSha256Hex(secret: string, message: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function getBearerToken(req: Request) {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed.slice("bearer ".length).trim();
  }
  return trimmed;
}

// Use jose for both Google and Apple JWT verification (web-compatible)
const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const appleJwks = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

async function verifyGoogleIdToken(idToken: string) {
  const audiences = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: audiences.length > 0 ? audiences : undefined,
  });

  if (!payload.sub) throw new Error("Invalid Google token");
  return {
    sub: payload.sub as string,
    email: payload.email as string | undefined,
    name: payload.name as string | undefined,
    picture: payload.picture as string | undefined,
  };
}

async function verifyAppleIdentityToken(identityToken: string) {
  const audience = process.env.AUTH_APPLE_ID ?? "com.muzammil.broski";

  const { payload } = await jwtVerify(identityToken, appleJwks, {
    issuer: "https://appleid.apple.com",
    audience,
  });

  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new Error("Invalid Apple token");
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;
  return { sub, email };
}

function getSessionTtlDays() {
  const raw = process.env.APP_SESSION_TTL_DAYS ?? "90";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 90;
  return parsed;
}

async function requireSession(ctx: any, req: Request) {
  const token = getBearerToken(req);
  if (!token) return { ok: false as const, response: error("Missing session token", 401) };
  const tokenHash = await sha256Hex(token);
  const result = await ctx.runQuery(internal.users.getSessionUser, { tokenHash });
  if (!result) return { ok: false as const, response: error("Invalid session", 401) };
  await ctx.runMutation(internal.users.touchSession, { tokenHash });
  return { ok: true as const, tokenHash, session: result.session, user: result.user };
}

function publicUser(user: any) {
  return {
    appUserId: user.appUserId,
    provider: user.provider,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoUrl,
    subscription: user.subscription
      ? {
          entitlementActive: user.subscription.entitlementActive,
          status: user.subscription.status,
          productId: user.subscription.productId,
          expiresAtMs: user.subscription.expiresAtMs,
        }
      : undefined,
  };
}

http.route({
  path: "/auth/google",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return error("Invalid JSON body", 400);
    }

    const idToken = body?.idToken;
    if (typeof idToken !== "string" || idToken.length < 10) {
      return error("Missing idToken", 400);
    }

    const payload = await verifyGoogleIdToken(idToken);
    const user = await ctx.runMutation(internal.users.upsertUserFromProvider, {
      provider: "google",
      providerUserId: payload.sub,
      appUserIdIfNew: crypto.randomUUID(),
      email: typeof payload.email === "string" ? payload.email : undefined,
      displayName: typeof payload.name === "string" ? payload.name : undefined,
      photoUrl: typeof payload.picture === "string" ? payload.picture : undefined,
    });

    const sessionToken = crypto.randomUUID() + "." + crypto.randomUUID();
    const tokenHash = await sha256Hex(sessionToken);
    const expiresAtMs =
      Date.now() + getSessionTtlDays() * 24 * 60 * 60 * 1000;

    await ctx.runMutation(internal.users.createSession, {
      userId: user._id,
      tokenHash,
      expiresAtMs,
      device: body?.device ?? undefined,
    });

    return json({
      ok: true,
      sessionToken,
      sessionExpiresAtMs: expiresAtMs,
      user: publicUser(user),
    });
  }),
});

http.route({
  path: "/auth/apple",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return error("Invalid JSON body", 400);
    }

    const identityToken = body?.identityToken;
    if (typeof identityToken !== "string" || identityToken.length < 10) {
      return error("Missing identityToken", 400);
    }

    const verified = await verifyAppleIdentityToken(identityToken);
    const displayName =
      typeof body?.displayName === "string" ? body.displayName : undefined;

    const user = await ctx.runMutation(internal.users.upsertUserFromProvider, {
      provider: "apple",
      providerUserId: verified.sub,
      appUserIdIfNew: crypto.randomUUID(),
      email: verified.email,
      displayName,
    });

    const sessionToken = crypto.randomUUID() + "." + crypto.randomUUID();
    const tokenHash = await sha256Hex(sessionToken);
    const expiresAtMs =
      Date.now() + getSessionTtlDays() * 24 * 60 * 60 * 1000;

    await ctx.runMutation(internal.users.createSession, {
      userId: user._id,
      tokenHash,
      expiresAtMs,
      device: body?.device ?? undefined,
    });

    return json({
      ok: true,
      sessionToken,
      sessionExpiresAtMs: expiresAtMs,
      user: publicUser(user),
    });
  }),
});

http.route({
  path: "/auth/signout",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const token = getBearerToken(req);
    if (!token) return json({ ok: true });
    const tokenHash = await sha256Hex(token);
    await ctx.runMutation(internal.users.revokeSession, { tokenHash });
    return json({ ok: true });
  }),
});

http.route({
  path: "/me",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const auth = await requireSession(ctx, req);
    if (!auth.ok) return auth.response;
    return json({ ok: true, user: publicUser(auth.user) });
  }),
});

http.route({
  path: "/me/license",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = await requireSession(ctx, req);
    if (!auth.ok) return auth.response;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return error("Invalid JSON body", 400);
    }

    const machineIdHash =
      typeof body?.machineIdHash === "string" ? body.machineIdHash.trim() : "";
    if (machineIdHash.length < 16 || machineIdHash.length > 128) {
      return error("Missing machineIdHash", 400);
    }

    const maxMachines = getMaxMachines();
    const upsert = await ctx.runMutation(internal.machines.upsertMachine, {
      userId: auth.user._id,
      machineIdHash,
      maxMachines,
    });
    if (!upsert.ok) {
      return error("Too many machines on this account", 403);
    }

    const privDerB64Url = (process.env.BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL ?? "").trim();
    if (!privDerB64Url) {
      return error("License signing key not configured", 500);
    }

    let key: CryptoKey;
    try {
      const privPem = derB64UrlToPem(privDerB64Url, "PRIVATE KEY");
      key = await importPKCS8(privPem, "EdDSA");
    } catch {
      return error("Invalid license signing key", 500);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const graceHoursRaw = Number(process.env.BROSKI_LICENSE_OFFLINE_GRACE_HOURS ?? "72");
    const graceHours = Number.isFinite(graceHoursRaw) ? graceHoursRaw : 72;
    const graceSec = Math.min(Math.max(graceHours, 1), 168) * 60 * 60; // cap 7 days

    const entitled = !!auth.user.subscription?.entitlementActive;
    const status = auth.user.subscription?.status ?? (entitled ? "active" : "inactive");
    const subscriptionExpiresAtMs = auth.user.subscription?.expiresAtMs ?? null;
    const subscriptionExpSec =
      subscriptionExpiresAtMs != null ? Math.floor(subscriptionExpiresAtMs / 1000) : null;

    let exp = nowSec + graceSec;
    if (subscriptionExpSec != null) {
      exp = Math.min(exp, subscriptionExpSec);
    }
    // If not entitled, keep the token short-lived to reduce stale caching.
    if (!entitled) {
      exp = Math.min(exp, nowSec + 300);
    }

    const payload = {
      appUserId: auth.user.appUserId,
      sessionTokenHash: auth.tokenHash,
      machineIdHash,
      entitled,
      status,
      iat: nowSec,
      exp,
    };

    let jws: string;
    try {
      jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
        .setProtectedHeader({ alg: "EdDSA", typ: "BRSK-LICENSE", kid: "v1" })
        .sign(key);
    } catch {
      return error("Failed to sign license", 500);
    }

    return json({ ok: true, license: jws, payload });
  }),
});

http.route({
  path: "/me/revenuecat/sync",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = await requireSession(ctx, req);
    if (!auth.ok) return auth.response;

    // Backwards-compat: older clients POSTed subscription fields here.
    // We intentionally ignore client-reported subscription state and instead
    // verify server-side against RevenueCat.
    try {
      // Allow empty body.
      await req.json();
    } catch {
      // Ignore invalid JSON bodies.
    }

    const rcApiKey = process.env.REVENUECAT_SECRET_API_KEY;
    if (!rcApiKey) {
      return error("RevenueCat API key not configured", 500);
    }

    const entitlementId = process.env.REVENUECAT_ENTITLEMENT_ID ?? "Pro";

    const subscriberUrl = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(
      auth.user.appUserId,
    )}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let response: Response;
    try {
      response = await fetch(subscriberUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${rcApiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
    } catch {
      return error("RevenueCat API request failed", 502);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return error("RevenueCat API error", 502);
    }

    let data: any;
    try {
      data = await response.json();
    } catch {
      return error("Invalid RevenueCat response", 502);
    }

    // RevenueCat API returns entitlements directly, NOT under an "active" sub-key
    const allEntitlements = data?.subscriber?.entitlements ?? {};
    const entitlement = allEntitlements?.[entitlementId];
    
    // Debug: log all available entitlement keys
    const availableEntitlementKeys = Object.keys(allEntitlements);
    console.log(`[RevenueCat Sync] Looking for entitlement: "${entitlementId}"`);
    console.log(`[RevenueCat Sync] Available entitlements: ${JSON.stringify(availableEntitlementKeys)}`);
    console.log(`[RevenueCat Sync] Found entitlement: ${entitlement ? 'yes' : 'no'}`);

    const parseNumber = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return undefined;
    };
    
    // Parse ISO date string to milliseconds
    const parseIsoDate = (v: unknown): number | undefined => {
      if (typeof v !== "string") return undefined;
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d.getTime() : undefined;
    };

    // RevenueCat returns expires_date as ISO string, not milliseconds
    const expiresAtMs =
      parseNumber(entitlement?.expires_date_ms) ??
      parseNumber(entitlement?.expiration_at_ms) ??
      parseNumber(entitlement?.expires_at_ms) ??
      parseIsoDate(entitlement?.expires_date);

    const productId =
      typeof entitlement?.product_identifier === "string"
        ? entitlement.product_identifier
        : undefined;

    const store = typeof entitlement?.store === "string" ? entitlement.store : undefined;
    const environment =
      typeof entitlement?.environment === "string" ? entitlement.environment : undefined;

    const originalAppUserId =
      typeof data?.subscriber?.original_app_user_id === "string"
        ? data.subscriber.original_app_user_id
        : undefined;

    const fetchedAtMs = Date.now();
    const entitlementActive = Boolean(entitlement) && (expiresAtMs ? expiresAtMs > fetchedAtMs : true);
    const status = entitlementActive ? "active" : "inactive";

    await ctx.runMutation(internal.users.updateSubscriptionFromRevenueCatApi, {
      userId: auth.user._id,
      entitlementActive,
      status,
      productId,
      expiresAtMs,
      originalAppUserId,
      store,
      environment,
      fetchedAtMs,
    });

    return json({
      ok: true,
      entitlementActive,
      status,
      productId,
      expiresAtMs,
      store,
      environment,
      // Debug info
      _debug: {
        lookedForEntitlement: entitlementId,
        availableEntitlements: availableEntitlementKeys,
        foundEntitlement: !!entitlement,
      },
    });
  }),
});

// NOTE: Trial abuse prevention is handled by App Store / Play Store at the
// Apple ID / Google account level. RevenueCat also tracks original_app_user_id
// across account deletions. Our tombstone table (deletedAccounts) records
// deletion metadata for analytics and fraud investigation.

http.route({
  path: "/me/delete",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = await requireSession(ctx, req);
    if (!auth.ok) return auth.response;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional for delete
    }

    const reason = typeof body?.reason === "string" ? body.reason : undefined;
    const feedback = typeof body?.feedback === "string" ? body.feedback : undefined;

    // Hash email and appUserId for tombstone (crypto.subtle available in httpAction)
    const hashedEmail = auth.user.email
      ? await sha256Hex(auth.user.email.toLowerCase())
      : undefined;
    const hashedAppUserId = await sha256Hex(auth.user.appUserId);

    await ctx.runMutation(internal.users.deleteAccountAndData, {
      userId: auth.user._id,
      hashedEmail,
      hashedAppUserId,
      reason,
      feedback,
    });

    return json({ ok: true });
  }),
});

// Recursively sanitize objects to rename keys starting with '$' (Convex reserved)
function sanitizeForConvex(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForConvex);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Rename keys starting with '$' to '_$' prefix
      const safeKey = key.startsWith("$") ? `_${key}` : key;
      result[safeKey] = sanitizeForConvex(value);
    }
    return result;
  }
  return obj;
}

http.route({
  path: "/webhooks/revenuecat",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!expected) {
      return error("RevenueCat webhook secret not configured", 500);
    }

    const got = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const normalized = (got ?? "").trim();
    if (normalized !== expected && normalized !== `Bearer ${expected}`) {
      return error("Unauthorized", 401);
    }

    let raw: any;
    try {
      raw = await req.json();
    } catch {
      return error("Invalid JSON body", 400);
    }

    // RevenueCat standard webhook shape: { event: { ... } }
    const event = raw?.event ?? raw;

    const receivedAtMs = Date.now();
    const eventType = typeof event?.type === "string" ? event.type : undefined;
    const appUserId =
      typeof event?.app_user_id === "string" ? event.app_user_id : undefined;
    const originalAppUserId =
      typeof event?.original_app_user_id === "string"
        ? event.original_app_user_id
        : undefined;
    const productId =
      typeof event?.product_id === "string" ? event.product_id : undefined;
    const expiresAtMs =
      typeof event?.expiration_at_ms === "number"
        ? event.expiration_at_ms
        : typeof event?.expiration_at_ms === "string"
          ? Number(event.expiration_at_ms)
          : undefined;
    const entitlementIds = Array.isArray(event?.entitlement_ids)
      ? event.entitlement_ids.filter((x: any) => typeof x === "string")
      : undefined;
    const store = typeof event?.store === "string" ? event.store : undefined;
    const environment =
      typeof event?.environment === "string" ? event.environment : undefined;

    // Sanitize raw payload to rename $-prefixed keys (Convex reserved)
    const sanitizedRaw = sanitizeForConvex(raw);

    await ctx.runMutation(internal.revenuecat.recordEventAndUpdateUser, {
      receivedAtMs,
      eventType,
      appUserId,
      originalAppUserId,
      productId,
      entitlementIds,
      expiresAtMs,
      store,
      environment,
      raw: sanitizedRaw,
    });

    return json({ ok: true });
  }),
});

http.route({
  path: "/webhooks/stripe",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return error("Stripe webhook secret not configured", 500);
    }

    const sigHeader =
      req.headers.get("stripe-signature") ?? req.headers.get("Stripe-Signature");
    if (!sigHeader) {
      return error("Missing Stripe-Signature header", 400);
    }

    const rawBody = await req.text();

    // Stripe signature header shape: "t=...,v1=...,v1=..."
    const parts = sigHeader.split(",").map((p) => p.trim());
    const timestampPart = parts.find((p) => p.startsWith("t="));
    const v1Parts = parts.filter((p) => p.startsWith("v1="));
    const ts = timestampPart ? Number(timestampPart.slice(2)) : NaN;
    const signatures = v1Parts.map((p) => p.slice(3)).filter(Boolean);

    if (!Number.isFinite(ts) || signatures.length === 0) {
      return error("Invalid Stripe-Signature header", 400);
    }

    // 5 minute replay tolerance (Stripe recommends short tolerances).
    const toleranceSec = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SEC ?? "300");
    if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) {
      return error("Webhook timestamp outside tolerance", 400);
    }

    const signedPayload = `${ts}.${rawBody}`;
    const expected = await hmacSha256Hex(secret, signedPayload);
    const ok = signatures.some((sig) => timingSafeEqualHex(sig, expected));
    if (!ok) {
      return error("Invalid Stripe webhook signature", 401);
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return error("Invalid JSON body", 400);
    }

    const receivedAtMs = Date.now();
    const eventType = typeof event?.type === "string" ? event.type : undefined;
    const stripeEventId = typeof event?.id === "string" ? event.id : undefined;
    const obj = event?.data?.object;

    // We expect subscription events to carry metadata.appUserId.
    const metaAppUserId =
      typeof obj?.metadata?.appUserId === "string" ? obj.metadata.appUserId : undefined;
    const stripeCustomerId =
      typeof obj?.customer === "string"
        ? obj.customer
        : typeof obj?.customer?.id === "string"
          ? obj.customer.id
          : undefined;
    const stripeSubscriptionId =
      typeof obj?.id === "string" ? obj.id : undefined;
    const status = typeof obj?.status === "string" ? obj.status : undefined;
    const currentPeriodEndMs =
      typeof obj?.current_period_end === "number"
        ? obj.current_period_end * 1000
        : undefined;

    const sanitizedRaw = sanitizeForConvex(event);

    await ctx.runMutation(internal.stripe.recordEventAndUpdateUser, {
      receivedAtMs,
      eventType,
      stripeEventId,
      appUserId: metaAppUserId,
      stripeCustomerId,
      stripeSubscriptionId,
      status,
      currentPeriodEndMs,
      raw: sanitizedRaw,
    });

    return json({ ok: true });
  }),
});

// NOTE: /hooks/bridge-install endpoint removed — unauthenticated, no rate
// limiting, anyone could spam thousands of DB writes to exhaust Convex quota.
// Re-add with auth or rate limiting when bridge binary distribution is live.

// ─── Machine management ────────────────────────────────────────────────────

http.route({
  path: "/me/machines",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const auth = await requireSession(ctx, req);
    if (!auth.ok) return auth.response;

    const machines = await ctx.runQuery(internal.machines.listActiveByUser, {
      userId: auth.user._id,
    });

    const maxMachines = getMaxMachines();

    return json({
      ok: true,
      maxMachines,
      machines: machines.map((m: any) => ({
        id: m._id,
        machineIdHash: m.machineIdHash,
        firstSeenAt: m.firstSeenAtMs,
        lastSeenAt: m.lastSeenAtMs,
      })),
    });
  }),
});

http.route({
  path: "/me/machines/revoke",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const auth = await requireSession(ctx, req);
    if (!auth.ok) return auth.response;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return error("Invalid JSON body", 400);
    }

    const machineId = typeof body?.machineId === "string" ? body.machineId.trim() : "";
    if (!machineId) {
      return error("Missing machineId", 400);
    }

    // Verify machine belongs to user
    const machines = await ctx.runQuery(internal.machines.listActiveByUser, {
      userId: auth.user._id,
    });

    const machine = machines.find((m: any) => m._id === machineId);
    if (!machine) {
      return error("Machine not found", 404);
    }

    // Revoke the machine
    await ctx.runMutation(internal.machines.revokeMachine, {
      machineId,
    });

    return json({ ok: true });
  }),
});

export default http;
