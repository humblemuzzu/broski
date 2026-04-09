import { z } from "zod";

// Zod v4: .default() requires the full output type — provide explicit defaults
export const BroskiConfigSchema = z.object({
	version: z.literal(1),
	wizard: z
		.object({
			completedSetup: z.boolean().default(false),
			lastRunAt: z.string().optional(),
			lastRunVersion: z.string().optional(),
		})
		.default({ completedSetup: false }),
	network: z
		.object({
			port: z.number().default(18274),
			mode: z.enum(["local", "tailscale", "hotspot-iphone", "hotspot-android"]).default("local"),
			enableFunnel: z.boolean().default(false),
		})
		.default({ port: 18274, mode: "local" as const, enableFunnel: false }),
	security: z
		.object({
			tls: z.boolean().default(true),
			tokenTtlDays: z.number().default(7),
			verifyCodeSignature: z.boolean().default(false),
		})
		.default({ tls: true, tokenTtlDays: 7, verifyCodeSignature: false }),
	agents: z
		.object({
			opencode: z.boolean().default(true),
			claudeCode: z.boolean().default(false),
			codex: z.boolean().default(false),
			pi: z.boolean().default(false),
		})
		.default({ opencode: true, claudeCode: false, codex: false, pi: false }),
	pi: z
		.object({
			enabled: z.boolean().optional(),
			agentDir: z.string().optional(),
			defaultProvider: z.string().optional(),
			defaultModel: z.string().optional(),
			defaultThinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
			extraExtensionPaths: z.array(z.string()).optional(),
		})
		.default({}),
	daemon: z
		.object({
			installed: z.boolean().default(false),
			type: z.enum(["launchagent", "systemd", "taskscheduler", "none"]).default("none"),
		})
		.default({ installed: false, type: "none" as const }),
});

export type BroskiConfig = z.infer<typeof BroskiConfigSchema>;
