/**
 * Shared beta mode utilities.
 *
 * Pure functions — no Convex mutations/queries. Consumed by
 * users.ts, revenuecat.ts, and stripe.ts to grant, check, and
 * protect beta subscriptions.
 */

const MS_PER_DAY = 86_400_000;

/** Minimal subscription shape needed for beta checks. */
type SubscriptionLike = {
  entitlementActive: boolean;
  status: string;
  source?: string;
  expiresAtMs?: number;
};

/** Whether the deployment has beta mode turned on. */
export function isBetaModeEnabled(): boolean {
  return process.env.BROSKI_BETA_MODE_ENABLED === "true";
}

/**
 * Trial length for beta grants.
 * Reads BROSKI_BETA_TRIAL_DAYS, defaults to 15, clamped to [1, 365].
 */
export function getBetaTrialDays(): number {
  const raw = parseInt(process.env.BROSKI_BETA_TRIAL_DAYS ?? "", 10);
  if (Number.isNaN(raw)) return 15;
  return Math.max(1, Math.min(365, raw));
}

/**
 * Build the subscription object for a new beta user.
 * Matches the `users.subscription` schema shape from schema.ts.
 */
export function makeBetaSubscription(now: number) {
  return {
    entitlementActive: true,
    status: "active",
    source: "beta",
    expiresAtMs: now + getBetaTrialDays() * MS_PER_DAY,
    lastEventType: "BETA_GRANT",
    lastEventAtMs: now,
  };
}

/**
 * Guard check: does this user already hold a live beta grant?
 *
 * Returns true when source is "beta", entitlement is active, and
 * the grant hasn't expired yet. Callers use this to avoid clobbering
 * an existing beta grant with a duplicate or with a webhook that
 * arrives before the trial ends.
 */
export function hasActiveBetaGrant(
  subscription: SubscriptionLike | undefined,
): boolean {
  if (!subscription) return false;
  return (
    subscription.source === "beta" &&
    subscription.entitlementActive === true &&
    subscription.expiresAtMs != null &&
    subscription.expiresAtMs > Date.now()
  );
}
