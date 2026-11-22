import { z } from "zod";
import { Adapters } from "./adapters";
import { DEFAULT_PORT, PORT_MAX, PORT_MIN } from "./port";

export type { AdapterEntry } from "./adapters";

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
			port: z.number().int().min(PORT_MIN).max(PORT_MAX).catch(DEFAULT_PORT).default(DEFAULT_PORT),
		})
		.default({ port: DEFAULT_PORT }),
	security: z
		.object({
			tls: z.boolean().default(true),
			verifyCodeSignature: z.boolean().default(false),
		})
		.default({ tls: true, verifyCodeSignature: false }),
	agents: z
		.object({
			claudeCode: z.boolean().default(true),
			pi: z.boolean().default(false),
		})
		.default({ claudeCode: true, pi: false }),
	claudeCode: z
		.object({
			/** The `claude` executable to run instead of the one on the login shell's `PATH` (`server/claude-cli-path.ts`). */
			cliPath: z.string().optional(),
			/** Answer a terminal `claude`'s permission prompts from the phone (a hook in its settings). */
			terminalAsks: z.boolean().default(true),
		})
		.default({ terminalAsks: true }),
	pi: z
		.object({
			/** The `pi` executable to run instead of the one on the login shell's `PATH` (`server/pi-cli-path.ts`). */
			cliPath: z.string().optional(),
			/** `false`: the contract's Pi installs no extension in the agent dir and takes the Broski link's out. */
			terminalLink: z.boolean().optional(),
		})
		.default({}),
	/** Tell every agent the bridge starts that its answers are read on a phone (`server/phone-writing.ts`). */
	phoneWriting: z.boolean().default(true),
	/** The bridge's own MCP tools offered to agents (`mcp/`): `notify` is `broski_notify`. */
	bridgeTools: z.object({ notify: z.boolean().default(true) }).default({ notify: true }),
	adapters: Adapters,
	daemon: z
		.object({
			installed: z.boolean().default(false),
			type: z.enum(["launchagent", "none"]).default("none"),
		})
		.default({ installed: false, type: "none" as const }),
});

export type BroskiConfig = z.infer<typeof BroskiConfigSchema>;
