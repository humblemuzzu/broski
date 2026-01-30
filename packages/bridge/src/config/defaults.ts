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
    network: {
      port: 18274,
      mode: 'local',
      enableFunnel: false,
    },
    security: {
      tls: true,
      tokenTtlDays: 7,
    },
    agents: {
      opencode: true,
      claudeCode: false,
      codex: false,
    },
    daemon: {
      installed: false,
      type: 'none',
    },
  }
}
