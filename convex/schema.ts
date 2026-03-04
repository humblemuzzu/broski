import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    // Stable external user id (safe to expose to clients + RevenueCat).
    appUserId: v.string(),

    provider: v.union(v.literal("google"), v.literal("apple")),
    providerUserId: v.string(),
    signUpMethod: v.union(v.literal("google"), v.literal("apple")),

    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    photoUrl: v.optional(v.string()),

    createdAtMs: v.number(),
    updatedAtMs: v.number(),
    lastSeenAtMs: v.optional(v.number()),

    revenueCat: v.optional(
      v.object({
        appUserId: v.optional(v.string()),
        originalAppUserId: v.optional(v.string()),
        lastEventType: v.optional(v.string()),
        lastEventAtMs: v.optional(v.number()),
      }),
    ),

    subscription: v.optional(
      v.object({
        entitlementActive: v.boolean(),
        status: v.string(),
        source: v.optional(v.string()), // "revenuecat" | "stripe" (string to keep migrations flexible)
        productId: v.optional(v.string()),
        expiresAtMs: v.optional(v.number()),
        store: v.optional(v.string()),
        environment: v.optional(v.string()),
        stripeCustomerId: v.optional(v.string()),
        stripeSubscriptionId: v.optional(v.string()),
        lastEventType: v.optional(v.string()),
        lastEventAtMs: v.optional(v.number()),
      }),
    ),
  })
    .index("by_provider_user", ["provider", "providerUserId"])
    .index("by_appUserId", ["appUserId"])
    .index("by_email", ["email"]),

  authSessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    createdAtMs: v.number(),
    lastUsedAtMs: v.number(),
    expiresAtMs: v.number(),
    revokedAtMs: v.optional(v.number()),
    device: v.optional(
      v.object({
        platform: v.optional(v.string()),
        deviceId: v.optional(v.string()),
        appVersion: v.optional(v.string()),
      }),
    ),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_userId", ["userId"]),

  revenuecatEvents: defineTable({
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
  }).index("by_appUserId", ["appUserId"]),

  machines: defineTable({
    userId: v.id("users"),
    machineIdHash: v.string(), // stable hash produced by the bridge (not raw hardware identifiers)
    firstSeenAtMs: v.number(),
    lastSeenAtMs: v.number(),
    revokedAtMs: v.optional(v.number()),
  })
    .index("by_user_machine", ["userId", "machineIdHash"])
    .index("by_machineIdHash", ["machineIdHash"])
    .index("by_userId", ["userId"]),

  stripeEvents: defineTable({
    receivedAtMs: v.number(),
    eventType: v.optional(v.string()),
    stripeEventId: v.optional(v.string()),
    appUserId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    status: v.optional(v.string()),
    currentPeriodEndMs: v.optional(v.number()),
    raw: v.optional(v.any()),
  })
    .index("by_appUserId", ["appUserId"])
    .index("by_stripeEventId", ["stripeEventId"]),

  deletedAccounts: defineTable({
    // SHA-256 hash of lowercase email — NOT the raw email (GDPR-safe)
    hashedEmail: v.optional(v.string()),
    // SHA-256 hash of the appUserId
    hashedAppUserId: v.string(),
    // Provider used (google/apple)
    provider: v.string(),
    // RevenueCat info at time of deletion
    hadActiveSubscription: v.boolean(),
    lastPlan: v.optional(v.string()),
    revenueCatOriginalAppUserId: v.optional(v.string()),
    // Deletion metadata
    deletedAtMs: v.number(),
    reason: v.optional(v.string()),
    feedback: v.optional(v.string()),
  })
    .index("by_hashedEmail", ["hashedEmail"])
    .index("by_hashedAppUserId", ["hashedAppUserId"]),

  bridgeInstalls: defineTable({
    platform: v.string(),           // "darwin-arm64", "linux-x64", etc.
    version: v.string(),            // "0.1.0"
    method: v.string(),             // "curl-installer", "powershell-installer", "manual"
    installedAtMs: v.number(),
    // Optional anonymous machine fingerprint (NOT identifying - just hostname hash)
    machineHash: v.optional(v.string()),
  })
    .index("by_platform", ["platform"])
    .index("by_version", ["version"])
    .index("by_installedAt", ["installedAtMs"]),

  waitlist: defineTable({
    email: v.string(),
    timestamp: v.string(),
    source: v.string(),
    country: v.optional(v.string()),
    city: v.optional(v.string()),
  })
    .index("by_email", ["email"]),
});
