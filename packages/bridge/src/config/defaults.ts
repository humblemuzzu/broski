import type { BroskiConfig } from "./schema";

/**
 * Returns a fresh default config object.
 * Each call returns a new object (no shared references).
 */
export function getDefaultConfig(): BroskiConfig {
	return {
		version: 1,
		wizard: {
			completedSetup: false,
			lastRunAt: undefined,
			lastRunVersion: undefined,
		},
		network: {
			port: 18274,
		},
		security: {
			tls: true,
			verifyCodeSignature: true, // Legacy field; integrity checks are always-on in compiled binaries regardless of this value.
		},
		agents: {
			claudeCode: true,
			pi: false,
		},
		claudeCode: { terminalAsks: true },
		pi: {},
		phoneWriting: true,
		daemon: {
			installed: false,
			type: "none",
		},
	};
}
