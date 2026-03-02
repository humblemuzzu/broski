import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { isBetaModeEnabled, makeBetaSubscription, hasActiveBetaGrant } from "./beta";

export type PublicUser = {
  appUserId: string;
  provider: "google" | "apple";
  email?: string;
  displayName?: string;
  photoUrl?: string;
  subscription?: {
    entitlementActive: boolean;
    status: string;
    productId?: string;
    expiresAtMs?: number;
  };
};

export const upsertUserFromProvider = internalMutation({
  args: {
    provider: v.union(v.literal("google"), v.literal("apple")),
    providerUserId: v.string(),
    appUserIdIfNew: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_provider_user", (q) =>
        q.eq("provider", args.provider).eq("providerUserId", args.providerUserId),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email ?? existing.email,
        displayName: args.displayName ?? existing.displayName,
        photoUrl: args.photoUrl ?? existing.photoUrl,
        updatedAtMs: now,
        lastSeenAtMs: now,
      });
      return (await ctx.db.get(existing._id))!;
    }

    const userId = await ctx.db.insert("users", {
      appUserId: args.appUserIdIfNew,
      provider: args.provider,
      providerUserId: args.providerUserId,
      signUpMethod: args.provider,
      email: args.email,
      displayName: args.displayName,
      photoUrl: args.photoUrl,
      createdAtMs: now,
      updatedAtMs: now,
      lastSeenAtMs: now,
      subscription: isBetaModeEnabled()
        ? makeBetaSubscription(now)
        : { entitlementActive: false, status: "none" },
      revenueCat: {
        appUserId: args.appUserIdIfNew,
      },
    });

    return (await ctx.db.get(userId))!;
  },
});

export const createSession = internalMutation({
  args: {
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAtMs: v.number(),
    device: v.optional(
      v.object({
        platform: v.optional(v.string()),
        deviceId: v.optional(v.string()),
        appVersion: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("authSessions", {
      userId: args.userId,
      tokenHash: args.tokenHash,
      createdAtMs: now,
      lastUsedAtMs: now,
      expiresAtMs: args.expiresAtMs,
      device: args.device,
    });
  },
});

export const revokeSession = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!session) return;
    if (session.revokedAtMs != null) return;
    await ctx.db.patch(session._id, { revokedAtMs: Date.now() });
  },
});

export const touchSession = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!session) return;
    if (session.revokedAtMs != null) return;
    await ctx.db.patch(session._id, { lastUsedAtMs: Date.now() });
  },
});

export const getSessionUser = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (!session) return null;
    if (session.revokedAtMs != null) return null;
    if (session.expiresAtMs <= Date.now()) return null;

    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    return { user, session };
  },
});

export const setRevenueCatIds = internalMutation({
  args: {
    appUserId: v.string(),
    revenueCatAppUserId: v.optional(v.string()),
    revenueCatOriginalAppUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_appUserId", (q) => q.eq("appUserId", args.appUserId))
      .unique();
    if (!user) return;
    const now = Date.now();
    await ctx.db.patch(user._id, {
      revenueCat: {
        ...(user.revenueCat ?? {}),
        appUserId: args.revenueCatAppUserId ?? user.revenueCat?.appUserId,
        originalAppUserId:
          args.revenueCatOriginalAppUserId ?? user.revenueCat?.originalAppUserId,
        lastEventAtMs: user.revenueCat?.lastEventAtMs,
        lastEventType: user.revenueCat?.lastEventType,
      },
      updatedAtMs: now,
    });
  },
});

export const deleteAccountAndData = internalMutation({
  args: {
    userId: v.id("users"),
    hashedEmail: v.optional(v.string()),
    hashedAppUserId: v.string(),
    reason: v.optional(v.string()),
    feedback: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { success: false, error: "User not found" };

    const now = Date.now();

    // 1. Create tombstone with pre-hashed data (non-reversible)
    await ctx.db.insert("deletedAccounts", {
      hashedEmail: args.hashedEmail,
      hashedAppUserId: args.hashedAppUserId,
      provider: user.provider,
      hadActiveSubscription: user.subscription?.entitlementActive ?? false,
      lastPlan: user.subscription?.productId,
      revenueCatOriginalAppUserId: user.revenueCat?.originalAppUserId,
      deletedAtMs: now,
      reason: args.reason,
      feedback: args.feedback,
    });

    // 2. Delete ALL auth sessions for this user
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // 3. Delete all RevenueCat events for this user
    const rcEvents = await ctx.db
      .query("revenuecatEvents")
      .withIndex("by_appUserId", (q) => q.eq("appUserId", user.appUserId))
      .collect();
    for (const event of rcEvents) {
      await ctx.db.delete(event._id);
    }

    // 4. Delete the user record
    await ctx.db.delete(args.userId);

    return { success: true };
  },
});

export const checkDeletedAccount = internalQuery({
  args: { hashedEmail: v.string() },
  handler: async (ctx, args) => {
    const tombstone = await ctx.db
      .query("deletedAccounts")
      .withIndex("by_hashedEmail", (q) => q.eq("hashedEmail", args.hashedEmail))
      .first();
    return tombstone;
  },
});

export const updateSubscriptionFromRevenueCatApi = internalMutation({
  args: {
    userId: v.id("users"),
    entitlementActive: v.boolean(),
    status: v.string(),
    productId: v.optional(v.string()),
    expiresAtMs: v.optional(v.number()),
    originalAppUserId: v.optional(v.string()),
    store: v.optional(v.string()),
    environment: v.optional(v.string()),
    fetchedAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const now = Date.now();

    // Guard: don't let a RevenueCat sync (which returns "no subscription" for
    // beta users) clobber an active beta grant. If RC reports entitled=true
    // (real purchase), let it through — that upgrades them to a paid subscriber.
    if (hasActiveBetaGrant(user.subscription) && !args.entitlementActive) {
      // Still update RC tracking fields for analytics, but leave subscription intact.
      await ctx.db.patch(args.userId, {
        revenueCat: {
          ...(user.revenueCat ?? {}),
          originalAppUserId:
            args.originalAppUserId ?? user.revenueCat?.originalAppUserId,
          lastEventType: "REVENUECAT_API",
          lastEventAtMs: args.fetchedAtMs,
        },
        updatedAtMs: now,
        lastSeenAtMs: now,
      });
      return;
    }

    await ctx.db.patch(args.userId, {
      subscription: {
        entitlementActive: args.entitlementActive,
        status: args.status,
        source: "revenuecat",
        productId: args.productId ?? user.subscription?.productId,
        expiresAtMs: args.expiresAtMs ?? user.subscription?.expiresAtMs,
        store: args.store ?? user.subscription?.store,
        environment: args.environment ?? user.subscription?.environment,
        lastEventType: "REVENUECAT_API",
        lastEventAtMs: args.fetchedAtMs,
      },
      revenueCat: {
        ...(user.revenueCat ?? {}),
        originalAppUserId:
          args.originalAppUserId ?? user.revenueCat?.originalAppUserId,
        lastEventType: "REVENUECAT_API",
        lastEventAtMs: args.fetchedAtMs,
      },
      updatedAtMs: now,
      lastSeenAtMs: now,
    });
  },
});

// ============================================================================
// BETA ADMIN MUTATIONS
// Run from Convex Dashboard → Functions tab. Not exposed via HTTP.
// ============================================================================

/**
 * Extend (or grant) beta access for a single user by email.
 * If the user already has beta time left, adds extraDays on top.
 * If beta expired or user has no grant, starts fresh from now.
 *
 * Usage from Convex Dashboard:
 *   extendBetaAccess({ email: "tester@gmail.com", extraDays: 30 })
 */
export const extendBetaAccess = internalMutation({
  args: {
    email: v.string(),
    extraDays: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) return { ok: false, error: "User not found" };

    const now = Date.now();
    const clampedDays = Math.max(1, Math.min(365, args.extraDays));
    const msToAdd = clampedDays * 86_400_000;

    // If they have active beta time left, extend from current expiry.
    // Otherwise start fresh from now.
    const currentExpiry = user.subscription?.expiresAtMs ?? 0;
    const base = currentExpiry > now ? currentExpiry : now;
    const newExpiry = base + msToAdd;

    await ctx.db.patch(user._id, {
      subscription: {
        ...(user.subscription ?? { entitlementActive: false, status: "none" }),
        entitlementActive: true,
        status: "active",
        source: "beta",
        expiresAtMs: newExpiry,
        lastEventType: "BETA_EXTEND",
        lastEventAtMs: now,
      },
      updatedAtMs: now,
    });
    return {
      ok: true,
      email: args.email,
      newExpiresAt: new Date(newExpiry).toISOString(),
      daysAdded: clampedDays,
    };
  },
});

/**
 * Revoke beta access for a user immediately.
 * Sets entitlementActive=false and status="expired".
 * Note: source stays "beta" (Convex doesn't support unsetting fields via spread).
 * This is safe — hasActiveBetaGrant() also checks entitlementActive === true,
 * so a revoked user won't trigger the clobber guard.
 *
 * Usage from Convex Dashboard:
 *   revokeBetaAccess({ email: "abuser@gmail.com" })
 */
export const revokeBetaAccess = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    if (!user) return { ok: false, error: "User not found" };
    if (user.subscription?.source !== "beta") {
      return { ok: false, error: "User is not on a beta grant (source: " + (user.subscription?.source ?? "none") + ")" };
    }

    const now = Date.now();
    await ctx.db.patch(user._id, {
      subscription: {
        ...(user.subscription ?? { entitlementActive: false, status: "none" }),
        entitlementActive: false,
        status: "expired",
        lastEventType: "BETA_REVOKE",
        lastEventAtMs: now,
      },
      updatedAtMs: now,
    });
    return { ok: true, email: args.email, revokedAt: new Date(now).toISOString() };
  },
});

/**
 * List all users with active beta grants.
 * Useful for seeing who's on beta and when they expire.
 *
 * Usage from Convex Dashboard:
 *   listBetaUsers({})
 */
export const listBetaUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const allUsers = await ctx.db.query("users").collect();
    return allUsers
      .filter(
        (u) =>
          u.subscription?.source === "beta" &&
          u.subscription?.expiresAtMs != null &&
          u.subscription.expiresAtMs > now,
      )
      .map((u) => ({
        email: u.email ?? "no-email",
        displayName: u.displayName ?? "unknown",
        appUserId: u.appUserId,
        expiresAt: new Date(u.subscription!.expiresAtMs!).toISOString(),
        daysLeft: Math.max(0, Math.round((u.subscription!.expiresAtMs! - now) / 86_400_000)),
      }));
  },
});
