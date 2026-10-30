/**
 * What the interaction tests stand on: an event log for the live state, and a real Pi session (faux provider,
 * temp agent dir) hosted with its own desk, UI context and gate. The run bookkeeping the live
 * sessions do is stubbed here the way `ports.ts` promises it: a run context while a run
 * is on, its asks withdrawn when it settles or is aborted.
 */

import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type {
	AgentSession,
	AgentSessionRuntime,
	ExtensionError,
	InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { mintRunId, ToolCallIds } from "../../backends/pi/ids";
import { LiveState } from "../../backends/pi/live/live-state";
import type { PermissionsMode } from "../../backends/pi/modes";
import type { AskHost, GateHost, RunContext } from "../../backends/pi/ports";
import { sessionExtensions } from "../../backends/pi/ui/extensions";
import { InteractionDesk } from "../../backends/pi/ui/interactions";
import { permissionGateExtension } from "../../backends/pi/ui/permission-gate";
import { createRemoteUiContext } from "../../backends/pi/ui/ui-context";
import { emptySnapshot, type Interaction } from "../../contract";
import { EventLog } from "./event_log";
import { hostSpikeSession, spikeRuntimeFactory } from "./helpers/pi-spike";
import {
	createPiTestEnv,
	createTestModelRuntime,
	type FauxModels,
	type PiTestEnv,
	registerFaux,
} from "./helpers/pi-test-env";

export interface ToolStart {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly parentToolCallId: string | undefined;
}

export interface ToolResult {
	readonly toolName: string;
	readonly isError: boolean;
	readonly text: string;
}

export interface Rig {
	readonly env: PiTestEnv;
	readonly runtime: AgentSessionRuntime;
	readonly session: AgentSession;
	readonly faux: FauxModels;
	readonly desk: InteractionDesk;
	readonly live: LiveState;
	readonly log: EventLog;
	readonly mode: { value: PermissionsMode };
	readonly errors: ExtensionError[];
	readonly aborts: { count: number };
	readonly starts: ToolStart[];
	/** Calls the gate had blocked, read as the live session does when a call ends: the table forgets them at the next response. */
	readonly denied: string[];
	toolResults(): ToolResult[];
	currentRun(): RunContext | undefined;
	pending(): readonly Interaction[];
	bind(): Promise<void>;
	/** What an adapter's abort does: withdraw the run's asks, then abort Pi. */
	abort(): Promise<void>;
	dispose(): Promise<void>;
}

export interface RigOptions {
	readonly extensions?: InlineExtension[];
	readonly mode?: PermissionsMode;
	/** Replaces the gate's view of the permissions mode. */
	readonly gateHost?: GateHost;
	/** Runs once the temp directories exist, before the session is hosted. */
	readonly beforeHost?: (env: PiTestEnv) => void;
}

export async function createRig(options: RigOptions = {}): Promise<Rig> {
	const env = createPiTestEnv();
	options.beforeHost?.(env);
	const modelRuntime = await createTestModelRuntime(env);
	const faux = await registerFaux(modelRuntime, [{ id: "m1", reasoning: true }]);
	const log = new EventLog();
	const live = new LiveState(emptySnapshot(), Date.now);
	live.attach(log.sink);
	const mode = { value: options.mode ?? "off" };
	const aborts = { count: 0 };
	const errors: ExtensionError[] = [];
	const starts: ToolStart[] = [];
	const denied: string[] = [];
	let run: RunContext | undefined;
	let session: AgentSession | undefined;
	let disposed = false;

	const abort = async () => {
		if (run) desk.withdrawRun(run.runId);
		await session?.abort();
	};
	const host: AskHost = {
		live,
		activeRun: () => run,
		inCommand: () => false,
		abortRun: () => {
			aborts.count += 1;
			void abort();
		},
		now: Date.now,
	};
	const desk = new InteractionDesk(host);
	const allowed = new Set<string>();
	const gate = permissionGateExtension(
		options.gateHost ?? {
			permissions: () => mode.value,
			allowed: (tool) => allowed.has(tool),
			allowForSession: (tool) => {
				allowed.add(tool);
			},
		},
		desk,
		host,
	);
	const factory = spikeRuntimeFactory(modelRuntime, faux.handle.getModel(), [
		...sessionExtensions(gate),
		...(options.extensions ?? []),
	]);
	const runtime = await hostSpikeSession(env, factory);
	session = runtime.session;
	session.subscribe((event) => {
		log.trace.push(`session:${event.type}`);
		if (event.type === "agent_start" && run === undefined) {
			run = { runId: mintRunId(), tools: new ToolCallIds() };
			live.emit({ type: "run_started", runId: run.runId, trigger: "prompt" });
		}
		if (event.type === "tool_execution_end" && run?.tools.wasDenied(event.toolCallId)) denied.push(event.toolCallId);
		if (event.type === "message_start" && event.message.role === "assistant") run?.tools.nextResponse();
		if (event.type === "tool_execution_start") {
			run?.tools.liveId(event.toolCallId);
			starts.push({ toolCallId: event.toolCallId, toolName: event.toolName, parentToolCallId: event.parentToolCallId });
		}
		if (event.type === "agent_settled" && run) {
			desk.withdrawRun(run.runId);
			live.emit({
				type: "run_finished",
				runId: run.runId,
				outcome: event.aborted ? { kind: "aborted" } : { kind: "completed" },
			});
			run = undefined;
		}
	});
	return {
		env,
		runtime,
		session,
		faux,
		desk,
		live,
		log,
		mode,
		errors,
		aborts,
		starts,
		denied,
		toolResults: () => toolResultsOf(runtime.session),
		currentRun: () => run,
		pending: () => live.snapshot().interactions,
		bind: () =>
			runtime.session.bindExtensions({
				uiContext: createRemoteUiContext(desk, live),
				mode: "rpc",
				abortHandler: host.abortRun,
				onError: (error) => errors.push(error),
			}),
		abort,
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			desk.expireAll();
			await runtime.dispose();
			env.dispose();
		},
	};
}

type ToolArguments = Parameters<typeof fauxToolCall>[1];

export function toolCall(name: string, args: ToolArguments) {
	return fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
}

export function toolCalls(...calls: [string, ToolArguments][]) {
	return fauxAssistantMessage(
		calls.map(([name, args]) => fauxToolCall(name, args)),
		{ stopReason: "toolUse" },
	);
}

function toolResultsOf(session: AgentSession): ToolResult[] {
	return session.sessionManager.getEntries().flatMap((entry) => {
		if (entry.type !== "message" || entry.message.role !== "toolResult") return [];
		const text = entry.message.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("");
		return [{ toolName: entry.message.toolName, isError: entry.message.isError, text }];
	});
}
