import { expect } from "bun:test";
import type {
	AgentBackend,
	BackendHost,
	OpenResult,
	OpenSession,
	OpenTarget,
	SessionControl,
	SinkRecord,
} from "../../contract/backend";
import type { CatalogEvent } from "../../contract/catalog-events";
import { CONFORMANCE_RULES, checkRule } from "../../contract/testing/conformance";
import type { Rig } from "../../contract/testing/conformance-harness";
import type {
	ConformanceDriver,
	ConformanceFactory,
	ConformanceInstance,
} from "../../contract/testing/conformance-types";
import type { FakeBackendOptions } from "../../contract/testing/fake-backend";
import { fakeConformanceFactory } from "../../contract/testing/fake-conformance";

const TIMEOUT_MS = 150;

export const accepted = { status: "accepted" } as const;
export const refused = { status: "rejected", rejection: { code: "backend_error", message: "no" } } as const;

export type Base = ConformanceFactory;

export function honest(options: FakeBackendOptions = {}): Base {
	return fakeConformanceFactory(options);
}

export function breakInstance(change: (instance: ConformanceInstance) => ConformanceInstance, base = honest()): Base {
	return async (host) => change(await base(host));
}

export function breakDriver(change: (driver: ConformanceDriver) => Partial<ConformanceDriver>, base = honest()): Base {
	return breakInstance(
		(instance) => ({ ...instance, driver: { ...instance.driver, ...change(instance.driver) } }),
		base,
	);
}

/** A driver that declines `echo_model`, as one on a real model must. */
export function cannotEcho(base = honest()): Base {
	return breakDriver(
		(driver) => ({
			arrange: async (session, scenario) => scenario.kind !== "echo_model" && driver.arrange(session, scenario),
		}),
		base,
	);
}

export function breakBackend(change: (backend: AgentBackend) => Partial<AgentBackend>, base = honest()): Base {
	return breakInstance(
		(instance) => ({ ...instance, backend: { ...instance.backend, ...change(instance.backend) } }),
		base,
	);
}

/** Rewrites what `open` resolves with. */
export function breakOpen(
	change: (opened: Extract<OpenResult, { status: "accepted" }>, target: OpenTarget) => OpenResult,
	base = honest(),
): Base {
	return breakBackend(
		(backend) => ({
			open: async (target, sink) => {
				const opened = await backend.open(target, sink);
				return opened.status === "accepted" ? change(opened, target) : opened;
			},
		}),
		base,
	);
}

export function breakSessions(
	change: (session: OpenSession, target: OpenTarget) => OpenSession,
	base = honest(),
): Base {
	return breakOpen((opened, target) => ({ ...opened, session: change(opened.session, target) }), base);
}

export function breakControl(change: (control: SessionControl) => Partial<SessionControl>, base = honest()): Base {
	return breakSessions(
		(session) =>
			session.control ? { ...session, control: { ...session.control, ...change(session.control) } } : session,
		base,
	);
}

/** Rewrites what the adapter emits: each record becomes the records `rewrite` returns. */
export function breakStream(rewrite: (record: SinkRecord) => SinkRecord[], base = honest()): Base {
	return breakBackend(
		(backend) => ({
			open: (target, sink) =>
				backend.open(target, {
					emit: (record) => {
						for (const out of rewrite(record)) sink.emit(out);
					},
				}),
		}),
		base,
	);
}

/** Rewrites what the adapter tells the catalog. */
export function breakCatalog(rewrite: (event: CatalogEvent) => CatalogEvent[], base = honest()): Base {
	return async (host: BackendHost) =>
		base({
			catalog: {
				emit: (event) => {
					for (const out of rewrite(event)) host.catalog.emit(out);
				},
			},
		});
}

/** The rule must fail, for the reason `because` names, not for some unrelated error. */
export async function fails(factory: Base, check: (rig: Rig) => Promise<void>, because: RegExp): Promise<void> {
	const rule = CONFORMANCE_RULES.find((candidate) => candidate.check === check);
	if (!rule) throw new Error("the check is not a registered rule");
	const failure = await checkRule(factory, rule, TIMEOUT_MS).then(
		() => "the rule passed",
		(error: Error) => String(error),
	);
	expect(failure).toMatch(because);
}

export function record(event: SinkRecord["event"]): SinkRecord {
	return { at: Date.now(), event };
}
