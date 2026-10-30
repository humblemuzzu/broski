import { describe, test } from "bun:test";
import type { SessionSink } from "../contract";
import { compactionAndRetryCanBeCancelled } from "../contract/testing/rules-cancel";
import {
	accepted,
	breakBackend,
	breakControl,
	breakSessions,
	breakStream,
	fails,
	honest,
	refused,
} from "./helpers/broken-adapters";

/** The first call goes to the honest control, every later one is refused: a cancel that only works when none is needed. */
function refusingAfterTheFirst(method: "cancelCompaction" | "cancelRetry") {
	return breakControl((control) => {
		let calls = 0;
		const honestMethod = control[method]?.bind(control);
		return { [method]: async () => (calls++ === 0 && honestMethod ? honestMethod() : refused) };
	});
}

/** A control whose `method` also tells the sink something, which a cancel with nothing to cancel must not do. */
function noisy(method: "cancelCompaction" | "cancelRetry") {
	let sink: SessionSink | undefined;
	return breakBackend((backend) => ({
		open: async (target, given) => {
			sink = given;
			const opened = await backend.open(target, given);
			if (opened.status === "rejected" || !opened.session.control) return opened;
			const control = opened.session.control;
			const noise = async () => {
				sink?.emit({ at: Date.now(), event: { type: "notice", level: "info", text: "cancelled" } });
				return accepted;
			};
			return { ...opened, session: { ...opened.session, control: { ...control, [method]: noise } } };
		},
	}));
}

const finishedAs = (kind: "completed" | "aborted") =>
	breakStream((item) =>
		item.event.type === "compaction_finished" ? [{ ...item, event: { ...item.event, outcome: { kind } } }] : [item],
	);

describe("the cancel rule fails", () => {
	test("for a session that cancels a compaction but cannot compact", () =>
		fails(
			breakSessions((session) => {
				if (!session.control) return session;
				const { compact: _compact, ...control } = session.control;
				return { ...session, control };
			}),
			compactionAndRetryCanBeCancelled,
			/must compact/,
		));

	test("for a compaction cancel that is rejected when none is under way", () =>
		fails(
			breakControl(() => ({ cancelCompaction: async () => refused })),
			compactionAndRetryCanBeCancelled,
			/cancelling a compaction with none under way must be accepted/,
		));

	test("for a compaction cancel that says something when none is under way", () =>
		fails(
			noisy("cancelCompaction"),
			compactionAndRetryCanBeCancelled,
			/compaction with none under way emitted events/,
		));

	test("for a compaction that is rejected", () =>
		fails(
			breakControl(() => ({ compact: async () => refused })),
			compactionAndRetryCanBeCancelled,
			/compact was rejected/,
		));

	test("for a compaction that never starts", () =>
		fails(
			breakStream((item) => (item.event.type === "compaction_started" ? [] : [item])),
			compactionAndRetryCanBeCancelled,
			/timed out .* compaction_started/,
		));

	test("for a compaction cancel that is rejected while one is under way", () =>
		fails(
			refusingAfterTheFirst("cancelCompaction"),
			compactionAndRetryCanBeCancelled,
			/cancelling the compaction was rejected/,
		));

	test("for a cancelled compaction that finishes completed", () =>
		fails(finishedAs("completed"), compactionAndRetryCanBeCancelled, /a cancelled compaction finished completed/));

	test("for a compaction that cannot be run again after a cancel", () =>
		fails(
			breakControl((control) => {
				let calls = 0;
				return {
					compact: async (instructions) => (calls++ === 0 && control.compact ? control.compact(instructions) : refused),
				};
			}),
			compactionAndRetryCanBeCancelled,
			/compacting again after a cancel was rejected/,
		));

	test("for a compaction that finishes aborted every time", () =>
		fails(finishedAs("aborted"), compactionAndRetryCanBeCancelled, /the compaction after a cancel finished aborted/));

	test("for a retry cancel that is rejected when none is scheduled", () =>
		fails(
			breakControl(() => ({ cancelRetry: async () => refused })),
			compactionAndRetryCanBeCancelled,
			/cancelling a retry with none under way must be accepted/,
		));

	test("for a retry cancel that says something when none is scheduled", () =>
		fails(noisy("cancelRetry"), compactionAndRetryCanBeCancelled, /retry with none under way emitted events/));

	test("for a run that does not start", () =>
		fails(
			breakControl((control) => ({
				prompt: async (input) => (input.text.startsWith("Fail once") ? refused : control.prompt(input)),
			})),
			compactionAndRetryCanBeCancelled,
			/the run did not start/,
		));

	test("for a retry that is never scheduled", () =>
		fails(
			breakStream((item) => (item.event.type === "retry_scheduled" ? [] : [item])),
			compactionAndRetryCanBeCancelled,
			/timed out .* retry_scheduled/,
		));

	test("for a retry cancel that is rejected while one is scheduled", () =>
		fails(refusingAfterTheFirst("cancelRetry"), compactionAndRetryCanBeCancelled, /cancelling the retry was rejected/));

	test("for a cancelled retry that finishes successfully", () =>
		fails(
			breakStream((item) =>
				item.event.type === "retry_finished" ? [{ ...item, event: { ...item.event, succeeded: true } }] : [item],
			),
			compactionAndRetryCanBeCancelled,
			/a cancelled retry finished successfully/,
		));

	test("for a run whose cancelled retry carries on as if it had succeeded", () =>
		fails(
			breakStream((item) =>
				item.event.type === "run_finished"
					? [{ ...item, event: { ...item.event, outcome: { kind: "completed" } } }]
					: [item],
			),
			compactionAndRetryCanBeCancelled,
			/carried on as if it had succeeded/,
		));

	test("for a cancel that leaves the retry open", () =>
		fails(
			breakStream((item) => (item.event.type === "retry_finished" ? [] : [item])),
			compactionAndRetryCanBeCancelled,
			/timed out .* retry_finished/,
		));

	test("passes for the honest fake", () => fails(honest(), compactionAndRetryCanBeCancelled, /the rule passed/));
});
