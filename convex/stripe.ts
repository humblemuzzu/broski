import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { hasActiveBetaGrant } from "./beta";

export const recordEventAndUpdateUser = internalMutation({
  args: {
    receivedAtMs: v.number(),
    eventType: v.optional(v.string()),
    stripeEventId: v.optional(v.string()),
    appUserId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    status: v.optional(v.string()),
    currentPeriodEndMs: v.optional(v.number()),
    raw: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("stripeEvents", {
      receivedAtMs: args.receivedAtMs,
      eventType: args.eventType,
      stripeEventId: args.stripeEventId,
      appUserId: args.appUserId,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      status: args.status,
      currentPeriodEndMs: args.currentPeriodEndMs,
      raw: args.raw,
    });

    if (!args.appUserId) return;

    const user = await ctx.db
      .query("users")
      .withIndex("by_appUserId", (q) => q.eq("appUserId", args.appUserId!))
      .unique();
    if (!user) return;

    const now = Date.now();
    const status = (args.status ?? "").toLowerCase();
    const activeByStatus = status === "active" || status === "trialing";
    const activeByExpiry =
      args.currentPeriodEndMs != null ? args.currentPeriodEndMs > now : activeByStatus;
    const entitlementActive = activeByStatus && activeByExpiry;

    // Guard: don't let a Stripe webhook clobber an active beta grant.
    if (hasActiveBetaGrant(user.subscription) && !entitlementActive) {
      return; // Event is already logged above — subscription stays intact.
    }

    await ctx.db.patch(user._id, {
      subscription: {
        entitlementActive,
        status: args.status ?? (entitlementActive ? "active" : "inactive"),
        source: "stripe",
        stripeCustomerId: args.stripeCustomerId ?? user.subscription?.stripeCustomerId,
        stripeSubscriptionId:
          args.stripeSubscriptionId ?? user.subscription?.stripeSubscriptionId,
        expiresAtMs: args.currentPeriodEndMs ?? user.subscription?.expiresAtMs,
        lastEventType: args.eventType ?? user.subscription?.lastEventType,
        lastEventAtMs: args.receivedAtMs,
        // Keep RevenueCat fields intact if Stripe event didn't provide them.
        productId: user.subscription?.productId,
        store: user.subscription?.store,
        environment: user.subscription?.environment,
      },
      updatedAtMs: now,
      lastSeenAtMs: now,
    });
  },
});

