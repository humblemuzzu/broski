/**
 * Step 7 · the hooks a transcript records, for history. The CLI writes a hook's run as an `attachment` entry
 * (`hook_success`, `hook_non_blocking_error`, …, with `hookName`, `hookEvent`, `durationMs`; both verified against
 * the 2.1.316 CLI in `spike/hook_events.test.ts`) inside the parent chain, but the SDK's reader returns only `user`,
 * `assistant` and `system` entries (`sdk.mjs` `pwe`). So each hook is anchored to the nearest returned entry it
 * descends from, through the attachment and progress entries between them, and shown after that entry's own items.
 */

import type { ActivityStatus } from "../../../contract";
import { clip } from "../bounds";
import { isRecord } from "../json";

const MAX_OUTPUT_CHARS = 16_384;
const MAX_HOOKS = 20_000;
const MAX_LINKS = 200_000;
const MAX_ANCHOR_STEPS = 64;

const STATUS_OF: Readonly<Record<string, ActivityStatus>> = {
	hook_success: "succeeded",
	hook_non_blocking_error: "failed",
	hook_blocking_error: "failed",
	hook_error_during_execution: "failed",
	hook_cancelled: "cancelled",
};

export interface HookFact {
	readonly uuid: string;
	readonly name: string;
	readonly event?: string;
	readonly status: ActivityStatus;
	readonly output?: string;
	readonly durationMs?: number;
	readonly timestamp?: string;
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function hookOf(entry: Record<string, unknown>): HookFact | undefined {
	const attachment = entry.attachment;
	if (!isRecord(attachment) || typeof attachment.type !== "string") return undefined;
	const status = STATUS_OF[attachment.type];
	const name = text(attachment.hookName);
	if (status === undefined || name === undefined || typeof entry.uuid !== "string") return undefined;
	const event = text(attachment.hookEvent);
	const output = text(attachment.content) ?? text(attachment.stderr) ?? text(attachment.stdout);
	const duration = attachment.durationMs;
	const timestamp = text(entry.timestamp);
	return {
		uuid: entry.uuid,
		name,
		status,
		...(event !== undefined && { event }),
		...(output !== undefined && { output: clip(output, MAX_OUTPUT_CHARS) }),
		...(typeof duration === "number" && Number.isSafeInteger(duration) && duration >= 0 && { durationMs: duration }),
		...(timestamp !== undefined && { timestamp }),
	};
}

/** Collects, in file order, the hooks of one file and the returned entry each one belongs after. */
export class HookCollector {
	private readonly parents = new Map<string, string>();
	private readonly byAnchor = new Map<string, HookFact[]>();
	private count = 0;

	constructor(private readonly chain: ReadonlySet<string>) {}

	/** An entry the reader does not return, under `parent`: a hook's way back to the chain may pass through it. */
	link(uuid: string, parent: string): void {
		if (this.parents.size < MAX_LINKS) this.parents.set(uuid, parent);
	}

	/** One parsed `attachment` entry; its link must have been noted first. */
	note(entry: unknown): void {
		if (!isRecord(entry) || this.count >= MAX_HOOKS) return;
		const hook = hookOf(entry);
		const anchor = hook === undefined ? undefined : this.anchorOf(hook.uuid);
		if (hook === undefined || anchor === undefined) return;
		this.byAnchor.set(anchor, [...(this.byAnchor.get(anchor) ?? []), hook]);
		this.count += 1;
	}

	hooks(): ReadonlyMap<string, readonly HookFact[]> {
		return this.byAnchor;
	}

	private anchorOf(uuid: string): string | undefined {
		let at = this.parents.get(uuid);
		for (let step = 0; at !== undefined && step < MAX_ANCHOR_STEPS; step += 1) {
			if (this.chain.has(at)) return at;
			at = this.parents.get(at);
		}
		return undefined;
	}
}
