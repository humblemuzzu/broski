import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Internal query: get the waitlist count (called from httpAction)
export const count = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Convex doesn't have a direct COUNT — we query all docs but only pull _id
    // For small tables (<10k) this is fine. If it grows, add a counter doc.
    const all = await ctx.db.query("waitlist").collect();
    return all.length;
  },
});

// Internal mutation: join the waitlist (called from httpAction)
export const join = internalMutation({
  args: {
    email: v.string(),
    timestamp: v.string(),
    source: v.string(),
    country: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Field size limits
    if (args.email.length > 254) {
      return { alreadyExists: false, id: null, error: "Email too long" };
    }
    if (args.source.length > 100) {
      return { alreadyExists: false, id: null, error: "Source too long" };
    }
    if (args.country && args.country.length > 100) {
      return { alreadyExists: false, id: null, error: "Country too long" };
    }
    if (args.city && args.city.length > 100) {
      return { alreadyExists: false, id: null, error: "City too long" };
    }

    const normalizedEmail = args.email.toLowerCase().trim();

    // Check if already on the waitlist
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();

    if (existing) {
      return { alreadyExists: true, id: existing._id, error: null };
    }

    const id = await ctx.db.insert("waitlist", {
      email: normalizedEmail,
      timestamp: args.timestamp,
      source: args.source.slice(0, 100),
      country: args.country?.slice(0, 100),
      city: args.city?.slice(0, 100),
    });

    return { alreadyExists: false, id, error: null };
  },
});

// Internal mutation: seed from CSV (batch insert, skip duplicates)
export const seedBatch = internalMutation({
  args: {
    entries: v.array(
      v.object({
        email: v.string(),
        timestamp: v.string(),
        source: v.string(),
        country: v.optional(v.string()),
        city: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let skipped = 0;

    for (const entry of args.entries) {
      const normalizedEmail = entry.email.toLowerCase().trim();

      const existing = await ctx.db
        .query("waitlist")
        .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      await ctx.db.insert("waitlist", {
        email: normalizedEmail,
        timestamp: entry.timestamp,
        source: entry.source,
        country: entry.country || undefined,
        city: entry.city || undefined,
      });
      inserted++;
    }

    return { inserted, skipped };
  },
});

// Internal mutation: remove by email (for admin cleanup)
export const removeByEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const normalizedEmail = args.email.toLowerCase().trim();
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { deleted: true };
    }
    return { deleted: false };
  },
});
