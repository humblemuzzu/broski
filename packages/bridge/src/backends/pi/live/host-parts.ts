/**
 * The parts of one hosted session wired to each other, in three layers: what faces Pi (its process, entry cursor, usage
 * and settings), what runs a session (asks, runs, the queue, prompts) and what takes in its events. The host
 * (`session-host.ts`) drives them and answers what they ask of it (`HostLinks`).
 */

import type { ChildExit } from "../../../adapter-kit/stdio-child";
import { type AgentEvent, emptySnapshot, type SessionSummary } from "../../../contract";
import { permissionsSetting } from "../modes";
import type { AskHost } from "../ports";
import type { Deliver } from "../rpc/client";
import type { UiRequest } from "../rpc/frames";
import { InteractionDesk } from "../ui/interactions";
import { ChildFeeds } from "./child-feeds";
import { EntryCursor } from "./entry-cursor";
import { EventBridge } from "./event-bridge";
import type { HostEnvironment, HostStart } from "./host-environment";
import { HostLiveState } from "./host-live-state";
import { HostRow } from "./host-row";
import { PiChild } from "./pi-child";
import { PromptDesk } from "./prompt-desk";
import { QueueMirror } from "./queue-mirror";
import { RunTracker } from "./run-tracker";
import { SessionSettings } from "./settings";
import { UsageFeed } from "./usage-feed";

/** What the parts ask of the host that owns them. */
export interface HostLinks {
	/** An event any part emitted: the row follows it, and an idle host may end. */
	emitted(event: AgentEvent): void;
	/** Stops the active run without waiting for Pi (a gate's deny-and-stop, an abort that came before its run). */
	abortInBackground(): void;
	summary(): SessionSummary;
	/** A run is about to end: where the entries stand, the totals, the model. */
	settle(): Promise<void>;
	dialog(request: UiRequest): void;
	exited(exit: ChildExit, stderr: string): void;
	detached(replaced: boolean): void;
	replaying(replaying: boolean): void;
}

interface PiParts {
	readonly live: HostLiveState;
	readonly child: PiChild;
	readonly cursor: EntryCursor;
	readonly listRow: HostRow;
	readonly usage: UsageFeed;
	readonly settings: SessionSettings;
}

interface RunParts {
	readonly interactions: InteractionDesk;
	readonly runs: RunTracker;
	readonly queue: QueueMirror;
	readonly prompts: PromptDesk;
}

interface IntakeParts {
	readonly children: ChildFeeds;
	readonly events: EventBridge;
}

export type HostParts = PiParts & RunParts & IntakeParts;

export function assembleHostParts(env: HostEnvironment, start: HostStart, links: HostLinks): HostParts {
	// Pi's records arrive asynchronously, long after `events` below exists.
	const deliver: Deliver = (delivery) => events.deliver(delivery);
	let replaying = false;
	const adoptedStart = start.adoption?.runStartedAt;
	const liveNow = () => (replaying && adoptedStart !== undefined ? adoptedStart : env.now());
	const hookedLinks: HostLinks = {
		...links,
		replaying: (active) => {
			replaying = active && start.adoption !== undefined;
			links.replaying(active);
		},
	};
	const pi = piParts(env, start, hookedLinks, deliver, liveNow);
	const run = runParts(env, pi, hookedLinks);
	const { children, events } = intakeParts(env, start, pi, run, hookedLinks);
	return { ...pi, ...run, children, events };
}

function piParts(
	env: HostEnvironment,
	start: HostStart,
	links: HostLinks,
	deliver: Deliver,
	liveNow: () => number,
): PiParts {
	const live = new HostLiveState(
		{ ...emptySnapshot(), modes: [permissionsSetting(start.permissions.mode)] },
		liveNow,
		(event) => links.emitted(event),
	);
	const child = new PiChild(start.transport, deliver);
	const usage = new UsageFeed(child, live, () => settings.currentModel);
	const settings = new SessionSettings(
		{ child, live, models: env.models, cwd: start.cwd, modelSwitched: () => usage.refresh() },
		start.permissions,
	);
	return {
		live,
		child,
		usage,
		settings,
		cursor: new EntryCursor(child, start.lastEntryId, start.adoption?.seed),
		listRow: new HostRow(start.facts, live, env.catalog),
	};
}

function runParts(env: HostEnvironment, pi: PiParts, links: HostLinks): RunParts {
	const { live, child, usage, settings, cursor } = pi;
	const askHost: AskHost = {
		live,
		activeRun: () => runs.current() ?? prompts.startEarly(),
		inCommand: () => prompts.inCommand,
		abortRun: () => links.abortInBackground(),
		aborting: () => runs.aborting,
		now: env.now,
	};
	const interactions = new InteractionDesk(askHost);
	const runs = new RunTracker({ live, interactions, refreshUsage: () => usage.refresh() });
	const queue = new QueueMirror(live);
	const prompts = new PromptDesk({
		child,
		runs,
		queue,
		live,
		model: () => settings.currentModel,
		leafId: () => cursor.leafId,
		abort: () => links.abortInBackground(),
	});
	return { interactions, runs, queue, prompts };
}

function intakeParts(
	env: HostEnvironment,
	start: HostStart,
	pi: PiParts,
	run: RunParts,
	links: HostLinks,
): IntakeParts {
	const children = new ChildFeeds({
		parent: () => links.summary(),
		now: env.now,
		announce: (summary) => env.catalog.emit({ type: "session_updated", summary }),
	});
	const events = new EventBridge({
		live: pi.live,
		runs: run.runs,
		queue: run.queue,
		prompts: run.prompts,
		usage: pi.usage,
		cursor: pi.cursor,
		children,
		now: env.now,
		record: (record) => void pi.child.record(record),
		persistedPrompt: (entryId) => start.adoption?.prompts(entryId),
		adopted: start.adoption !== undefined,
		sessionId: start.facts.sessionId,
		cwd: start.cwd,
		...(env.images !== undefined && { images: env.images }),
		hooks: {
			userMessage: (text) => pi.listRow.userMessage(text),
			renamed: (name) => pi.listRow.renamed(name),
			thinkingChanged: (level) => pi.settings.thinkingChanged(level),
			settling: () => links.settle(),
			dialog: (request) => links.dialog(request),
			exited: (exit, stderr) => links.exited(exit, stderr),
			detached: (replaced) => links.detached(replaced),
			replaying: (replaying) => links.replaying(replaying),
		},
	});
	return { children, events };
}
