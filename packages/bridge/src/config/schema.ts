import { z } from "zod"

export const BroskiConfigSchema = z.object({
  version: z.literal(1),
  wizard: z.object({
    completedSetup: z.boolean().default(false),
    lastRunAt: z.string().optional(),
    lastRunVersion: z.string().optional(),
  }).default({}),
  cloud: z.object({
    convexHttpBaseUrl: z.string().default("https://neat-gerbil-813.convex.site"),
    requireEntitlement: z.boolean().default(true),
    entitlementCacheTtlMs: z.number().default(30_000),
    entitlementRecheckMs: z.number().default(30 * 60_000),
    offlineGraceHours: z.number().default(72),
  }).default({}),
  network: z.object({
    port: z.number().default(18274),
    mode: z.enum(["local", "tailscale", "hotspot-iphone", "hotspot-android"]).default("local"),
    enableFunnel: z.boolean().default(false),
  }).default({}),
  security: z.object({
    tls: z.boolean().default(true),
    tokenTtlDays: z.number().default(7),
    verifyCodeSignature: z.boolean().default(false),
  }).default({}),
  agents: z.object({
    opencode: z.boolean().default(true),
    claudeCode: z.boolean().default(false),
    codex: z.boolean().default(false),
  }).default({}),
  pi: z.object({
    enabled: z.boolean().optional(),
    agentDir: z.string().optional(),
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
    defaultThinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
    extraExtensionPaths: z.array(z.string()).optional(),
  }).default({}),
  daemon: z.object({
    installed: z.boolean().default(false),
    type: z.enum(["launchagent", "systemd", "taskscheduler", "none"]).default("none"),
  }).default({}),
})

export type BroskiConfig = z.infer<typeof BroskiConfigSchema>
