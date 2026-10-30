/**
 * A host's start: its runtime built (extensions loaded), then its extensions bound (`session_start`), together within
 * `START_DEADLINE_MS`. An extension that never finishes loading or starting, and never asks anyone, would otherwise
 * hold the open, and the session lock with it, for good. A runtime that arrives after its host gave up was never
 * bound: no `session_start` reached its extensions, so it is disposed without a `session_shutdown` either.
 */

import type { AgentSession, AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { NoticeEvent } from "../../../contract";
import type { AskHost, GateHost } from "../ports";
import { sessionExtensions } from "../ui/extensions";
import type { InteractionDesk } from "../ui/interactions";
import { permissionGateExtension } from "../ui/permission-gate";
import { ExtensionBinding } from "./extension-binding";
import type { HostStart } from "./host-environment";
import { createHostedRuntime, type SharedServices } from "./runtime-factory";
import { within } from "./shutdown";
import { startupNotices } from "./startup-notices";

/** Inside the core's 30 s for an open (`core/deadline.ts`), with the host's end (`HOST_END_BUDGET_MS`) after it. */
export const START_DEADLINE_MS = 20_000;

export interface HostStartup {
	readonly shared: SharedServices;
	readonly start: HostStart;
	readonly interactions: InteractionDesk;
	readonly askHost: AskHost;
	readonly gate: GateHost;
	/** The host has ended (a shutdown) while it was starting. */
	readonly ended: () => boolean;
	readonly started: (runtime: AgentSessionRuntime, notices: readonly NoticeEvent[]) => void;
	/** The binding exists before Pi is called, so an ask from inside the call finds it (`extension-binding.ts`). */
	readonly binding: (binding: ExtensionBinding) => void;
	readonly bind: (session: AgentSession) => Parameters<AgentSession["bindExtensions"]>[0];
	readonly bindingFailedLate: (error: unknown) => void;
	readonly bindingEnded: () => void;
}

const ENDED = "the session ended as it started";

export async function startHostRuntime(startup: HostStartup): Promise<void> {
	const until = Date.now() + START_DEADLINE_MS;
	const { start } = startup;
	const gate = permissionGateExtension(startup.gate, startup.interactions, startup.askHost);
	const creating = createHostedRuntime(startup.shared, {
		cwd: start.cwd,
		sessionManager: start.sessionManager,
		extensions: sessionExtensions(gate),
		...(start.model && { model: start.model }),
		...(start.thinkingLevel && { thinkingLevel: start.thinkingLevel }),
	});
	const created = await within(creating, START_DEADLINE_MS, undefined);
	if (created === undefined) {
		creating.then(({ runtime }) => runtime.session.dispose()).catch(() => undefined);
		throw new Error(`Pi did not load the session's extensions within ${START_DEADLINE_MS / 1000} s`);
	}
	if (startup.ended()) {
		created.runtime.session.dispose();
		throw new Error(ENDED);
	}
	const { runtime } = created;
	startup.started(runtime, startupNotices(runtime, created.missingPackages, created.scopeWarnings));
	const binding = new ExtensionBinding({ failedLate: startup.bindingFailedLate, ended: startup.bindingEnded });
	startup.binding(binding);
	binding.start(() => runtime.session.bindExtensions(startup.bind(runtime.session)));
	const opened = await within(
		binding.opened().then(() => true),
		until - Date.now(),
		false,
	);
	if (!opened) throw new Error(`an extension's session_start did not return within ${START_DEADLINE_MS / 1000} s`);
	if (startup.ended()) throw new Error(ENDED);
}
