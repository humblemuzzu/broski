import { describe, test } from "bun:test";
import type { PromptResult } from "../contract/input";
import {
	abortEndsTheRun,
	aRepeatedPromptRunsOnce,
	queuedInputCanBeSeenAndCancelled,
	startWhileRunningIsBusy,
	steerJoinsTheRun,
} from "../contract/testing/rules-runs";
import {
	accepted,
	breakBackend,
	breakControl,
	breakDriver,
	breakOpen,
	breakStream,
	fails,
	record,
	refused,
} from "./helpers/broken-adapters";

describe("the repeated prompt rule fails", () => {
	test("for a prompt that is not de-duplicated", () =>
		fails(
			breakControl((control) => ({
				prompt: (input) => control.prompt({ ...input, clientRequestId: crypto.randomUUID() }),
			})),
			aRepeatedPromptRunsOnce,
			/different result/,
		));

	test("for a prompt that reaches the model twice", () =>
		fails(
			breakStream((item) => (item.event.type === "user_message" ? [item, item] : [item])),
			aRepeatedPromptRunsOnce,
			/reached the model 2 times/,
		));

	test("for a repeat that starts another run", () =>
		fails(
			breakControl((control) => {
				const seen = new Map<string, PromptResult>();
				return {
					prompt: async (input) => {
						const first = seen.get(input.clientRequestId);
						if (!first) {
							const result = await control.prompt(input);
							seen.set(input.clientRequestId, result);
							return result;
						}
						await control.prompt({ ...input, mode: "queue", clientRequestId: crypto.randomUUID() });
						return first;
					},
				};
			}),
			aRepeatedPromptRunsOnce,
			/started another run/,
		));

	test("for a start accepted during the run it waits behind", () =>
		fails(
			breakControl((control) => ({
				prompt: async (input) => {
					const result = await control.prompt(input);
					return result.status === "rejected" ? { status: "accepted", disposition: "queued" } : result;
				},
			})),
			aRepeatedPromptRunsOnce,
			/start during a run must be rejected busy/,
		));

	test("for a rejection that is remembered", () =>
		fails(
			breakControl((control) => {
				const seen = new Map<string, PromptResult>();
				return {
					prompt: async (input) => {
						const result = seen.get(input.clientRequestId) ?? (await control.prompt(input));
						seen.set(input.clientRequestId, result);
						return result;
					},
				};
			}),
			aRepeatedPromptRunsOnce,
			/rejected busy was remembered/,
		));
});

describe("the busy rule fails", () => {
	test("for a start accepted while a run is active", () =>
		fails(
			breakControl((control) => ({
				prompt: async (input) => {
					const result = await control.prompt(input);
					return result.status === "rejected" ? { status: "accepted", disposition: "queued" } : result;
				},
			})),
			startWhileRunningIsBusy,
			/rejected busy/,
		));
});

describe("the steer rule fails", () => {
	test("for a steer that only queues", () =>
		fails(
			breakControl((control) => ({
				prompt: (input) => control.prompt(input.mode === "steer" ? { ...input, mode: "queue" } : input),
			})),
			steerJoinsTheRun,
			/steer was not steered/,
		));

	test("for a steer accepted though undeclared", () =>
		fails(
			breakBackend((backend) => ({ traits: { ...backend.traits, promptModes: ["start", "queue"] } })),
			steerJoinsTheRun,
			/steer is not declared yet accepted/,
		));
});

describe("the queue rule fails", () => {
	test("for a queued prompt that is not queued", () =>
		fails(
			breakControl((control) => ({
				prompt: (input) => control.prompt(input.mode === "queue" ? { ...input, mode: "steer" } : input),
			})),
			queuedInputCanBeSeenAndCancelled,
			/queue was not queued/,
		));

	test("for queued input missing from the queue", () =>
		fails(
			breakStream((item) =>
				item.event.type === "queue_changed" ? [{ ...item, event: { type: "queue_changed", items: [] } }] : [item],
			),
			queuedInputCanBeSeenAndCancelled,
			/timed out .* queue_changed/,
		));

	test("for an event of a capability the traits deny", () =>
		fails(
			breakBackend((backend) => ({ traits: { ...backend.traits, queue: false } })),
			queuedInputCanBeSeenAndCancelled,
			/a queue from a backend without one/,
		));

	test("for queued input that cannot be named", () =>
		fails(
			breakControl((control) => ({
				prompt: async (input) => {
					const result = await control.prompt(input);
					if (result.status !== "accepted") return result;
					const { queueItemId: _id, ...rest } = result;
					return rest;
				},
			})),
			queuedInputCanBeSeenAndCancelled,
			/must name the queued item/,
		));

	test("for a cancel that is rejected", () =>
		fails(
			breakControl(() => ({ cancelQueued: async () => refused })),
			queuedInputCanBeSeenAndCancelled,
			/cancelling the queued item was rejected/,
		));

	test("for a cancel that changes nothing", () =>
		fails(
			breakControl(() => ({ cancelQueued: async () => accepted })),
			queuedInputCanBeSeenAndCancelled,
			/timed out .* queue_changed/,
		));

	test("for a second cancel that is accepted", () =>
		fails(
			breakControl((control) => ({
				cancelQueued: async (id) => {
					await control.cancelQueued?.(id);
					return accepted;
				},
			})),
			queuedInputCanBeSeenAndCancelled,
			/cancelling twice must be rejected/,
		));

	test("for a queue accepted though undeclared", () =>
		fails(
			breakBackend((backend) => ({ traits: { ...backend.traits, promptModes: ["start", "steer"] } })),
			queuedInputCanBeSeenAndCancelled,
			/queue is not declared yet accepted/,
		));
});

describe("the abort rule fails", () => {
	test("for an abort rejected with no run", () =>
		fails(
			breakControl(() => ({ abort: async () => refused })),
			abortEndsTheRun,
			/abort with no run must be accepted/,
		));

	test("for an abort with no run that emits", () =>
		fails(
			breakBackend((backend) => ({
				open: async (target, sink) => {
					const opened = await backend.open(target, sink);
					if (opened.status === "rejected" || !opened.session.control) return opened;
					const control = opened.session.control;
					const abort = async () => {
						const result = await control.abort();
						queueMicrotask(() => sink.emit(record({ type: "notice", level: "info", text: "nothing to stop" })));
						return result;
					};
					return { ...opened, session: { ...opened.session, control: { ...control, abort } } };
				},
			})),
			abortEndsTheRun,
			/abort with no run emitted events/,
		));

	test("for an abort rejected during a run", () =>
		fails(
			breakOpen((opened) => {
				const control = opened.session.control;
				if (!control) return opened;
				const abort = async () => (opened.session.snapshot().run ? refused : control.abort());
				return { ...opened, session: { ...opened.session, control: { ...control, abort } } };
			}),
			abortEndsTheRun,
			/abort was rejected/,
		));

	test("for a hold that does not hold", () =>
		fails(
			breakDriver(
				(driver) => ({
					arrange: (session, scenario) =>
						driver.arrange(session, scenario.kind === "hold" ? { kind: "reply" } : scenario),
				}),
				breakControl((control) => ({
					prompt: async (input) => {
						const result = await control.prompt(input);
						await new Promise((resolve) => setImmediate(resolve));
						return result;
					},
				})),
			),
			abortEndsTheRun,
			/no run is active to abort/,
		));

	test("for a prompt that never starts its run", () =>
		fails(
			breakControl(() => ({ prompt: async () => ({ status: "accepted", disposition: "handled" }) })),
			abortEndsTheRun,
			/the run did not start/,
		));

	test("for an abort that does nothing", () =>
		fails(
			breakControl(() => ({ abort: async () => accepted })),
			abortEndsTheRun,
			/timed out .* run_finished/,
		));

	test("for an aborted run reported as completed", () =>
		fails(
			breakStream((item) =>
				item.event.type === "run_finished" && item.event.outcome.kind === "aborted"
					? [{ ...item, event: { ...item.event, outcome: { kind: "completed" } } }]
					: [item],
			),
			abortEndsTheRun,
			/an aborted run ended completed/,
		));
});
