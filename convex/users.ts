import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

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
      subscription: {
        entitlementActive: false,
        status: "none",
      },
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

export const updateSubscriptionFromClient = internalMutation({
  args: {
    userId: v.id("users"),
    entitlementActive: v.boolean(),
    status: v.string(),
    productId: v.optional(v.string()),
    expiresAtMs: v.optional(v.number()),
    originalAppUserId: v.optional(v.string()),
    store: v.optional(v.string()),
    environment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return;
    const now = Date.now();

    await ctx.db.patch(args.userId, {
      subscription: {
        entitlementActive: args.entitlementActive,
        status: args.status,
        productId: args.productId ?? user.subscription?.productId,
        expiresAtMs: args.expiresAtMs ?? user.subscription?.expiresAtMs,
        store: args.store ?? user.subscription?.store,
        environment: args.environment ?? user.subscription?.environment,
        lastEventType: "CLIENT_SYNC",
        lastEventAtMs: now,
      },
      revenueCat: {
        ...(user.revenueCat ?? {}),
        originalAppUserId: args.originalAppUserId ?? user.revenueCat?.originalAppUserId,
        lastEventType: "CLIENT_SYNC",
        lastEventAtMs: now,
      },
      updatedAtMs: now,
      lastSeenAtMs: now,
    });
  },
});
