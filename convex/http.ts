import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createRemoteJWKSet, jwtVerify } from "jose";

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
  const audience = process.env.AUTH_APPLE_ID ?? "com.muzammil.broski.auth";

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

    const activeEntitlements = data?.subscriber?.entitlements?.active ?? {};
    const entitlement = activeEntitlements?.[entitlementId];

    const parseNumber = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return undefined;
    };

    const expiresAtMs =
      parseNumber(entitlement?.expires_date_ms) ??
      parseNumber(entitlement?.expiration_at_ms) ??
      parseNumber(entitlement?.expires_at_ms);

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

// NOTE: /hooks/bridge-install endpoint removed — unauthenticated, no rate
// limiting, anyone could spam thousands of DB writes to exhaust Convex quota.
// Re-add with auth or rate limiting when bridge binary distribution is live.

export default http;
