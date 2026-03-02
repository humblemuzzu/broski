import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { hasActiveBetaGrant } from "./beta";

type RevenueCatEventSummary = {
  eventType?: string;
  appUserId?: string;
  originalAppUserId?: string;
  productId?: string;
  entitlementIds?: string[];
  expiresAtMs?: number;
  store?: string;
  environment?: string;
  raw?: unknown;
};

export const recordEventAndUpdateUser = internalMutation({
  args: {
    receivedAtMs: v.number(),
    eventType: v.optional(v.string()),
    appUserId: v.optional(v.string()),
    originalAppUserId: v.optional(v.string()),
    productId: v.optional(v.string()),
    entitlementIds: v.optional(v.array(v.string())),
    expiresAtMs: v.optional(v.number()),
    store: v.optional(v.string()),
    environment: v.optional(v.string()),
    raw: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("revenuecatEvents", {
      receivedAtMs: args.receivedAtMs,
      eventType: args.eventType,
      appUserId: args.appUserId,
      originalAppUserId: args.originalAppUserId,
      productId: args.productId,
      entitlementIds: args.entitlementIds,
      expiresAtMs: args.expiresAtMs,
      store: args.store,
      environment: args.environment,
      raw: args.raw,
    });

    if (!args.appUserId) return;

    const user = await ctx.db
      .query("users")
      .withIndex("by_appUserId", (q) => q.eq("appUserId", args.appUserId!))
      .unique();
    if (!user) return;

    const now = Date.now();
    const entitlementActive =
      args.expiresAtMs != null ? args.expiresAtMs > now : false;

    // Guard: don't let a RevenueCat webhook (e.g. EXPIRATION for a product the
    // beta user never bought) clobber an active beta grant. If the webhook
    // reports entitled=true (real purchase), let it through to upgrade them.
    if (hasActiveBetaGrant(user.subscription) && !entitlementActive) {
      return; // Event is already logged above — subscription stays intact.
    }

    await ctx.db.patch(user._id, {
      subscription: {
        entitlementActive,
        status: entitlementActive ? "active" : "inactive",
        source: "revenuecat",
        productId: args.productId ?? user.subscription?.productId,
        expiresAtMs: args.expiresAtMs ?? user.subscription?.expiresAtMs,
        store: args.store ?? user.subscription?.store,
        environment: args.environment ?? user.subscription?.environment,
        lastEventType: args.eventType ?? user.subscription?.lastEventType,
        lastEventAtMs: args.receivedAtMs,
      },
      revenueCat: {
        ...(user.revenueCat ?? {}),
        appUserId: args.appUserId ?? user.revenueCat?.appUserId,
        originalAppUserId:
          args.originalAppUserId ?? user.revenueCat?.originalAppUserId,
        lastEventType: args.eventType ?? user.revenueCat?.lastEventType,
        lastEventAtMs: args.receivedAtMs,
      },
      updatedAtMs: now,
      lastSeenAtMs: now,
    });
  },
});

