/** How a host's parts are joined: what each one is given of the others. The host's parts are public for this file only. */

import type { Rejected, SessionId } from "../../../contract";
import type { AskDesk } from "../ports/asks";
import type { LiveDeps } from "../ports/deps";
import type { SessionEmitter } from "../ports/live";
import type { ChildRouter } from "./child-router";
import { reportContextAfterRun } from "./context-after-run";
import { FrameHandler } from "./frame-handler";
import type { MappedRouting } from "./mapped-routing";
import type { ProcessSlot } from "./process-slot";
import { PromptDesk } from "./prompt-desk";
import type { InputQueue } from "./queue";
import { endRun, type RunEndDeps } from "./run-end";
import type { RunTracker } from "./run-tracker";
import type { SerialLock } from "./serial";
import type { SessionSettings } from "./settings";

export interface HostParts {
	readonly deps: LiveDeps;
	readonly cwd: string;
	readonly live: SessionEmitter;
	readonly runs: RunTracker;
	readonly queue: InputQueue;
	readonly children: ChildRouter;
	readonly desk: AskDesk;
	readonly settings: SessionSettings;
	readonly routing: MappedRouting;
	readonly lock: SerialLock;
	readonly slot: ProcessSlot;
	readonly sessionId: SessionId;
	readonly ended: boolean;
	ensureProcess(): Promise<Rejected | undefined>;
	rowChanged(): void;
	markPersisted(): void;
	cancelledBeforeStart(): void;
	stopAgain(): void;
	conversationReset(newId: SessionId): void;
}

export function runEndOf(host: HostParts, prompts: PromptDesk): RunEndDeps {
	return {
		live: host.live,
		runs: host.runs,
		queue: host.queue,
		prompts,
		children: host.children,
		desk: host.desk,
		mapper: () => host.routing.current,
		emitMapped: (events) => host.routing.emit(events),
		finished: () => host.rowChanged(),
		measureContext: () =>
			reportContextAfterRun({ live: host.live, query: () => host.slot.alive?.query, closed: () => host.ended }),
	};
}

export function promptDeskOf(host: HostParts): PromptDesk {
	return new PromptDesk({
		live: host.live,
		runs: host.runs,
		queue: host.queue,
		ownership: host.deps.ownership,
		sessionId: () => host.sessionId,
		noteSend: (uuid) => host.routing.current.noteSend(uuid),
		ensureProcess: () => host.ensureProcess(),
		push: (message) => host.slot.push(message),
		alive: () => host.slot.alive !== undefined,
		closed: () => host.ended,
		locked: (work) => host.lock.run(work),
		runBegan: () => host.rowChanged(),
	});
}

export function frameHandlerOf(host: HostParts, prompts: PromptDesk): FrameHandler {
	return new FrameHandler({
		live: host.live,
		runs: host.runs,
		queue: host.queue,
		children: host.children,
		desk: host.desk,
		settings: host.settings,
		mapping: host.deps.mapping,
		mapper: () => host.routing.current,
		catalogue: host.deps.catalogue,
		cwd: host.cwd,
		emitMapped: (events) => host.routing.emit(events),
		persisted: () => host.markPersisted(),
		systemRun: () => {
			host.runs.start("system");
			host.rowChanged();
		},
		endRun: () => endRun(runEndOf(host, prompts)),
		cancelledBeforeStart: () => host.cancelledBeforeStart(),
		stopAgain: () => host.stopAgain(),
		conversationReset: (newId) => host.conversationReset(newId),
	});
}
