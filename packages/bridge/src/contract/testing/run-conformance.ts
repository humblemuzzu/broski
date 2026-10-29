import { describe, test } from "bun:test";
import { CONFORMANCE_RULES, checkRule, DEFAULT_RULE_TIMEOUT_MS } from "./conformance";
import type { ConformanceFactory } from "./conformance-types";

/** Registers one bun test per conformance rule for the backend `factory` makes. */
export function runConformance(name: string, factory: ConformanceFactory, timeoutMs = DEFAULT_RULE_TIMEOUT_MS): void {
	describe(`${name} conforms to the backend contract`, () => {
		for (const rule of CONFORMANCE_RULES) {
			test(rule.name, () => checkRule(factory, rule, timeoutMs), timeoutMs * 20);
		}
	});
}
