/**
 * Transcript lines as live events of a watch-only session (D28). Only these lines mean something:
 * `user` (a prompt, a tool result, an interruption), `assistant` (one block), `system/turn_duration` (the turn is over),
 * `system/compact_boundary` and `system/local_command` (a slash command's output). Every other line is list metadata or
 * noise. A line's `uuid` is seen once.
 */

import type { RunId, ToolCallId } from "../../../contract";
import { fitsId } from "../bounds";
import { userItemId } from "../ids";
import { isRecord } from "../json";
import { commandOutputActivity } from "../mapping/activities";
import { harnessText } from "../mapping/harness-text";
import type { MappedEvent } from "../ports/mapping";
import { canonicalInput } from "./canonical";
import { assistantEvents } from "./translate-assistant";
import { TranslatorState } from "./translate-state";
import { userEvents } from "./translate-user";

export class LineTranslator {
	private readonly state = new TranslatorState();

	/** The events one parsed line shows; never throws. */
	translate(line: unknown): MappedEvent[] {
		const entry = isRecord(line) ? line : undefined;
		const uuid = entry === undefined ? undefined : fresh(this.state, entry);
		if (entry === undefined || uuid === undefined || entry.isSidechain === true) return [];
		switch (entry.type) {
			case "assistant":
				return assistantEvents(this.state, entry);
			case "user":
				return userEvents(this.state, entry, uuid);
			case "system":
				return systemEvents(this.state, entry, uuid);
			default:
				return [];
		}
	}

	/** A line that was in the file before the tail began: remembered, never shown. */
	remember(line: unknown): void {
		if (isRecord(line) && typeof line.uuid === "string") this.state.seenUuids.add(line.uuid);
	}

	/** The run has nothing left to wait for: no tool is open and the last message ended the turn. */
	get settled(): boolean {
		return this.state.settled;
	}

	get runId(): RunId | undefined {
		return this.state.runId;
	}

	/** Finishes a settled run the file never closed (a session written without `turn_duration`). */
	settle(): MappedEvent[] {
		const out: MappedEvent[] = [];
		if (this.state.settled) this.state.finishRun(out, "completed");
		return out;
	}

	/** A run to raise an ask on: a permission prompt means a turn is under way. */
	ensureRun(): { readonly runId: RunId; readonly events: MappedEvent[] } {
		const events: MappedEvent[] = [];
		return { runId: this.state.startRun(events), events };
	}

	/** The id of the open tool call that has this name and input, when exactly one has. */
	openToolMatching(name: string, input: unknown): ToolCallId | undefined {
		const key = canonicalInput(input);
		const sameInput = [...this.state.tools].filter(
			([, tool]) => tool.name === name && canonicalInput(tool.input) === key,
		);
		if (sameInput.length === 1) return sameInput[0]?.[0];
		const sameName = [...this.state.tools].filter(([, tool]) => tool.name === name);
		return sameName.length === 1 ? sameName[0]?.[0] : undefined;
	}

	/** How many calls of this tool are waiting for a result. */
	openToolsNamed(name: string): number {
		return [...this.state.tools.values()].filter((tool) => tool.name === name).length;
	}
}

function fresh(state: TranslatorState, entry: Record<string, unknown>): string | undefined {
	const uuid = entry.uuid;
	if (typeof uuid !== "string" || state.seenUuids.has(uuid)) return undefined;
	state.seenUuids.add(uuid);
	return uuid;
}

function systemEvents(state: TranslatorState, entry: Record<string, unknown>, uuid: string): MappedEvent[] {
	const out: MappedEvent[] = [];
	if (entry.subtype === "turn_duration") {
		state.finishRun(out, "completed");
	} else if (entry.subtype === "compact_boundary") {
		compactionEvents(out, entry.compactMetadata);
	} else if (entry.subtype === "local_command" && typeof entry.content === "string" && fitsId(uuid)) {
		const printed = harnessText(entry.content);
		const activity =
			printed.kind === "command_output" ? commandOutputActivity(printed.text, printed.failed) : undefined;
		if (activity !== undefined) out.push({ event: { type: "activity", activityId: userItemId(uuid), activity } });
	}
	return out;
}

function compactionEvents(out: MappedEvent[], metadata: unknown): void {
	const meta = isRecord(metadata) ? metadata : {};
	const before = wholeCount(meta.preTokens);
	const after = wholeCount(meta.postTokens);
	out.push({
		event: {
			type: "compaction_started",
			trigger: meta.trigger === "manual" ? "manual" : "auto",
		},
	});
	out.push({
		event: {
			type: "compaction_finished",
			outcome: {
				kind: "completed",
				...(before !== undefined && { tokensBefore: before }),
				...(after !== undefined && { tokensAfter: after }),
			},
		},
	});
}

function wholeCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
