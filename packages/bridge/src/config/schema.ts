import { z } from "zod"

export const BroskiConfigSchema = z.object({
  version: z.literal(1),
  wizard: z.object({
    completedSetup: z.boolean().default(false),
    lastRunAt: z.string().optional(),
    lastRunVersion: z.string().optional(),
  }).default({}),
  network: z.object({
    port: z.number().default(18274),
    mode: z.enum(["local", "tailscale", "hotspot-iphone", "hotspot-android"]).default("local"),
    enableFunnel: z.boolean().default(false),
  }).default({}),
  security: z.object({
    tls: z.boolean().default(true),
    tokenTtlDays: z.number().default(7),
  }).default({}),
  agents: z.object({
    opencode: z.boolean().default(true),
    claudeCode: z.boolean().default(false),
    codex: z.boolean().default(false),
  }).default({}),
  daemon: z.object({
    installed: z.boolean().default(false),
    type: z.enum(["launchagent", "systemd", "taskscheduler", "none"]).default("none"),
  }).default({}),
})

export type BroskiConfig = z.infer<typeof BroskiConfigSchema>
