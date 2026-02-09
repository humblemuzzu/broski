import type { DoctorContext } from '../context'
import type { CheckResult, DoctorProfile } from '../types'
import { runSystemChecks } from './system'
import { runDependencyChecks } from './dependencies'
import { runNetworkChecks } from './network'
import { runSecurityChecks } from './security'
import { runDaemonChecks } from './daemon'
import { runAgentChecks } from './agents'
import { runConnectivityChecks } from './connectivity'

const PROFILE_CATEGORIES: Record<DoctorProfile, Set<CheckResult['category']>> = {
  all: new Set(['system', 'dependencies', 'network', 'security', 'daemon', 'agents', 'connectivity']),
  network: new Set(['network', 'connectivity']),
  pairing: new Set(['network', 'security', 'connectivity']),
  agents: new Set(['dependencies', 'agents']),
  daemon: new Set(['daemon', 'connectivity', 'network']),
  security: new Set(['security']),
}

export async function runAllChecks(
  ctx: DoctorContext,
  opts: { deep?: boolean; profile?: DoctorProfile } = {},
): Promise<CheckResult[]> {
  const results: CheckResult[] = [
    ...(await runSystemChecks(ctx)),
    ...(await runDependencyChecks()),
    ...(await runNetworkChecks(ctx, { deep: opts.deep })),
    ...(await runSecurityChecks(ctx)),
    ...(await runDaemonChecks(ctx, { deep: opts.deep })),
    ...(await runAgentChecks()),
    ...(await runConnectivityChecks(ctx, { deep: opts.deep })),
  ]

  const profile = opts.profile ?? 'all'
  const allowed = PROFILE_CATEGORIES[profile]
  return results.filter((result) => allowed.has(result.category))
}
