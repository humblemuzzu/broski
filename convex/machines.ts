import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const listActiveByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("machines")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.filter((m) => m.revokedAtMs == null);
  },
});

export const upsertMachine = internalMutation({
  args: {
    userId: v.id("users"),
    machineIdHash: v.string(),
    maxMachines: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const existing = await ctx.db
      .query("machines")
      .withIndex("by_user_machine", (q) =>
        q.eq("userId", args.userId).eq("machineIdHash", args.machineIdHash),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAtMs: now,
        revokedAtMs: undefined,
      });
      return { ok: true as const };
    }

    const active = await ctx.db
      .query("machines")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const activeCount = active.filter((m) => m.revokedAtMs == null).length;
    if (activeCount >= args.maxMachines) {
      return { ok: false as const, error: "TOO_MANY_MACHINES" as const };
    }

    await ctx.db.insert("machines", {
      userId: args.userId,
      machineIdHash: args.machineIdHash,
      firstSeenAtMs: now,
      lastSeenAtMs: now,
      revokedAtMs: undefined,
    });

    return { ok: true as const };
  },
});

