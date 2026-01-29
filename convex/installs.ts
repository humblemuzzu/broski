import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const recordInstall = internalMutation({
  args: {
    platform: v.string(),
    version: v.string(),
    method: v.string(),
    machineHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("bridgeInstalls", {
      ...args,
      installedAtMs: Date.now(),
    });
  },
});
