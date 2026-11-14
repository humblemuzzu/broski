import type { BackendTraits, SinkRecord } from "../backend";
import { type AgentEvent, EventEnvelope } from "../events";
import type { BlockId, InteractionId, RunId, ToolCallId } from "../ids";
import type { SessionSnapshot } from "../snapshot";

const SinkRecordSchema = EventEnvelope.omit({ seq: true, session: true });

interface OpenBlockState {
	readonly kind: "text" | "thinking" | "plan";
	text: string;
	deltas: boolean;
}

/** What the checker remembers between events. Ids once seen stay seen, across `resynced` too. */
class StreamState {
	run: RunId | undefined;
	readonly blocks = new Map<BlockId, OpenBlockState>();
	readonly tools = new Set<ToolCallId>();
	readonly runTools = new Set<ToolCallId>();
	readonly seenBlocks = new Set<BlockId>();
	readonly seenTools = new Set<ToolCallId>();
	readonly interactions = new Map<InteractionId, RunId | undefined>();
	readonly resolved = new Set<InteractionId>();
	retrying = false;
	compacting = false;

	constructor(snapshot: SessionSnapshot) {
		this.reset(snapshot);
	}

	reset(snapshot: SessionSnapshot): void {
		this.run = snapshot.run?.runId;
		this.blocks.clear();
		this.tools.clear();
		this.runTools.clear();
		this.interactions.clear();
		for (const block of snapshot.blocks) {
			this.blocks.set(block.blockId, { kind: block.kind, text: block.text, deltas: true });
			this.seenBlocks.add(block.blockId);
		}
		for (const tool of snapshot.tools) {
			this.tools.add(tool.toolCallId);
			this.runTools.add(tool.toolCallId);
			this.seenTools.add(tool.toolCallId);
		}
		for (const item of snapshot.run?.items ?? []) {
			if (item.kind === "block") this.seenBlocks.add(item.id);
			if (item.kind === "tool_call") {
				this.runTools.add(item.toolCallId);
				this.seenTools.add(item.toolCallId);
			}
		}
		for (const interaction of snapshot.interactions) this.interactions.set(interaction.id, interaction.runId);
		this.retrying = snapshot.retry !== undefined;
		this.compacting = snapshot.compaction !== undefined;
	}
}

/**
 * Every way `records` breaks the contract's stream rules, given the live state `initial` the stream
 * started from and the traits the adapter declared. Empty when the stream is valid.
 */
export function streamViolations(
	records: readonly SinkRecord[],
	traits: BackendTraits,
	initial: SessionSnapshot,
): string[] {
	const state = new StreamState(initial);
	const violations: string[] = [];
	records.forEach((record, index) => {
		const parsed = SinkRecordSchema.safeParse(record);
		if (!parsed.success) {
			violations.push(`#${index}: not a valid record: ${parsed.error.message}`);
			return;
		}
		for (const problem of eventProblems(state, traits, record.event)) {
			violations.push(`#${index} ${record.event.type}: ${problem}`);
		}
	});
	return violations;
}

/** The stream is at rest: no run, nothing open, nothing pending, no compaction or retry under way. */
export function unsettledParts(records: readonly SinkRecord[], initial: SessionSnapshot): string[] {
	const state = new StreamState(initial);
	for (const record of records) eventProblems(state, undefined, record.event);
	return [
		...(state.run ? [`run ${state.run} never finished`] : []),
		...[...state.blocks.keys()].map((id) => `block ${id} never finished`),
		...[...state.tools].map((id) => `tool ${id} never finished`),
		...[...state.interactions.keys()].map((id) => `interaction ${id} never resolved`),
		...(state.compacting ? ["a compaction never finished"] : []),
		...(state.retrying ? ["a retry never finished"] : []),
	];
}

function eventProblems(state: StreamState, traits: BackendTraits | undefined, event: AgentEvent): string[] {
	switch (event.type) {
		case "run_started":
			return runStarted(state, event.runId);
		case "run_finished":
			return runFinished(state, event.runId);
		case "block_started":
		case "block_delta":
		case "block_finished":
			return blockProblems(state, traits, event);
		case "tool_started":
		case "tool_updated":
		case "tool_finished":
			return toolProblems(state, traits, event);
		case "interaction_requested":
		case "interaction_resolved":
			return interactionProblems(state, traits, event);
		case "retry_scheduled":
			state.retrying = true;
			return state.run ? [] : ["a retry outside a run"];
		case "retry_finished":
			return wasOpen(state, "retrying", "a retry finished that never started");
		case "compaction_started": {
			const problems = state.compacting ? ["a compaction started while one is under way"] : [];
			state.compacting = true;
			return problems;
		}
		case "compaction_finished":
			return wasOpen(state, "compacting", "a compaction finished that never started");
		case "resynced":
			state.reset(event.snapshot);
			return [];
		default:
			return traits ? declared(traits, event) : [];
	}
}

function runStarted(state: StreamState, runId: RunId): string[] {
	const problems = state.run ? [`run ${runId} started while run ${state.run} is active`] : [];
	state.run = runId;
	state.runTools.clear();
	return problems;
}

function runFinished(state: StreamState, runId: RunId): string[] {
	const problems: string[] = [];
	if (state.run !== runId) problems.push(`run ${runId} finished but the active run is ${state.run ?? "none"}`);
	if (state.blocks.size > 0) problems.push(`blocks still open: ${[...state.blocks.keys()].join(", ")}`);
	if (state.tools.size > 0) problems.push(`tools still running: ${[...state.tools].join(", ")}`);
	const pending = [...state.interactions].filter(([, run]) => run === runId).map(([id]) => id);
	if (pending.length > 0) problems.push(`interactions of the run still pending: ${pending.join(", ")}`);
	if (state.retrying) problems.push("a retry is still scheduled");
	if (state.compacting) problems.push("a compaction is still under way");
	state.run = undefined;
	return problems;
}

function blockProblems(
	state: StreamState,
	traits: BackendTraits | undefined,
	event: Extract<AgentEvent, { type: "block_started" | "block_delta" | "block_finished" }>,
): string[] {
	if (event.type === "block_started") {
		const problems: string[] = [];
		if (!state.run) problems.push("a block outside a run");
		if (state.seenBlocks.has(event.blockId)) problems.push(`block id ${event.blockId} reused`);
		if (event.parentToolCallId !== undefined && !state.runTools.has(event.parentToolCallId)) {
			problems.push(`parent tool ${event.parentToolCallId} is not a tool of this run`);
		}
		if (traits && event.kind === "plan" && !traits.planProposals) problems.push("plan blocks without planProposals");
		state.seenBlocks.add(event.blockId);
		state.blocks.set(event.blockId, { kind: event.kind, text: "", deltas: false });
		return problems;
	}
	const block = state.blocks.get(event.blockId);
	if (!block) return [`block ${event.blockId} is not open`];
	if (event.type === "block_delta") {
		block.text += event.text;
		block.deltas = true;
		const streams = block.kind === "thinking" ? traits?.streamThinking : traits?.streamText;
		return traits && !streams ? [`${block.kind} deltas from a backend that does not stream them`] : [];
	}
	state.blocks.delete(event.blockId);
	return block.deltas && block.text !== event.text ? ["the finished text differs from the deltas"] : [];
}

function toolProblems(
	state: StreamState,
	traits: BackendTraits | undefined,
	event: Extract<AgentEvent, { type: "tool_started" | "tool_updated" | "tool_finished" }>,
): string[] {
	if (event.type === "tool_started") {
		const problems: string[] = [];
		if (!state.run) problems.push("a tool outside a run");
		if (state.seenTools.has(event.toolCallId)) problems.push(`tool call id ${event.toolCallId} reused`);
		if (event.parentToolCallId !== undefined && !state.tools.has(event.parentToolCallId)) {
			problems.push(`parent tool ${event.parentToolCallId} is not running`);
		}
		state.seenTools.add(event.toolCallId);
		state.tools.add(event.toolCallId);
		state.runTools.add(event.toolCallId);
		return problems;
	}
	if (!state.tools.has(event.toolCallId)) return [`tool ${event.toolCallId} is not running`];
	if (event.type === "tool_finished") {
		state.tools.delete(event.toolCallId);
		return [];
	}
	return traits && event.update.kind === "child_session" && !traits.children
		? ["a child session without children"]
		: [];
}

function interactionProblems(
	state: StreamState,
	traits: BackendTraits | undefined,
	event: Extract<AgentEvent, { type: "interaction_requested" | "interaction_resolved" }>,
): string[] {
	if (event.type === "interaction_resolved") {
		if (state.resolved.has(event.interactionId)) return [`interaction ${event.interactionId} resolved twice`];
		if (!state.interactions.has(event.interactionId)) return [`interaction ${event.interactionId} was never requested`];
		state.interactions.delete(event.interactionId);
		state.resolved.add(event.interactionId);
		return [];
	}
	const interaction = event.interaction;
	const problems: string[] = [];
	if (state.interactions.has(interaction.id) || state.resolved.has(interaction.id)) {
		problems.push(`interaction id ${interaction.id} reused`);
	}
	if (interaction.runId !== undefined && interaction.runId !== state.run) {
		problems.push(`interaction of run ${interaction.runId} while the active run is ${state.run ?? "none"}`);
	}
	if (interaction.blocksRun && interaction.runId === undefined) problems.push("a blocking interaction names no run");
	if (traits && !traits.interactions.includes(interaction.request.kind)) {
		problems.push(`${interaction.request.kind} is not a declared interaction kind`);
	}
	state.interactions.set(interaction.id, interaction.runId);
	return problems;
}

function wasOpen(state: StreamState, flag: "retrying" | "compacting", problem: string): string[] {
	const open = state[flag];
	state[flag] = false;
	return open ? [] : [problem];
}

/** Events a backend may only emit for a capability it declares. */
function declared(traits: BackendTraits, event: AgentEvent): string[] {
	switch (event.type) {
		case "queue_changed": {
			const ids = event.items.map((item) => item.id);
			return [
				...(traits.queue ? [] : ["a queue from a backend without one"]),
				...(new Set(ids).size === ids.length ? [] : ["queue item ids repeat"]),
			];
		}
		case "input_returned":
			return traits.queue ? [] : ["queued input handed back by a backend without a queue"];
		case "usage_updated":
			return traits.usage ? [] : ["usage from a backend that does not report it"];
		case "extension":
			return traits.extensions.includes(event.extension.kind) ? [] : [`undeclared extension ${event.extension.kind}`];
		default:
			return [];
	}
}
