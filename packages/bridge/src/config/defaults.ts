import type { BroskiConfig } from './schema'

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
    cloud: {
      convexHttpBaseUrl: 'https://neat-gerbil-813.convex.site',
      requireEntitlement: true,
      entitlementCacheTtlMs: 30_000,
      entitlementRecheckMs: 30 * 60_000,
      offlineGraceHours: 72,
    },
    network: {
      port: 18274,
      mode: 'local',
      enableFunnel: false,
    },
    security: {
      tls: true,
      tokenTtlDays: 7,
      verifyCodeSignature: true, // Legacy field; integrity checks are always-on in compiled binaries regardless of this value.
    },
    agents: {
      opencode: true,
      claudeCode: false,
      codex: false,
      pi: false,
    },
    pi: {
      enabled: false,
      defaultThinkingLevel: 'medium',
      extraExtensionPaths: [],
    },
    daemon: {
      installed: false,
      type: 'none',
    },
  }
}
