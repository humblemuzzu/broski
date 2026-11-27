import { describe, test } from "bun:test";
import { answerProblem } from "../contract/answer-check";
import type { Interaction } from "../contract/interactions";
import { declaredInteractionsAnswerCorrectly } from "../contract/testing/rules-interactions";
import { breakBackend, breakDriver, breakSessions, breakStream, fails, refused } from "./helpers/broken-adapters";

describe("the interaction rule fails", () => {
	test("for an answer accepted without checking it", () =>
		fails(
			breakSessions((session) => {
				const control = session.control;
				if (!control) return session;
				return {
					...session,
					control: {
						...control,
						answer: async (answer) => {
							const pending = session
								.snapshot()
								.interactions.find((candidate) => candidate.id === answer.interactionId);
							return pending && answerProblem(pending, answer) !== undefined
								? { status: "accepted" }
								: control.answer(answer);
						},
					},
				};
			}),
			declaredInteractionsAnswerCorrectly,
			/was not rejected invalid_input/,
		));

	test("for a plan approval that takes a mode the plan did not offer", () =>
		fails(
			breakSessions((session) => {
				const control = session.control;
				if (!control) return session;
				return {
					...session,
					control: {
						...control,
						answer: async (answer) => {
							if (answer.reply.kind !== "plan_approval") return control.answer(answer);
							const { modeAfter: _ignored, ...reply } = answer.reply;
							return control.answer({ ...answer, reply });
						},
					},
				};
			}),
			declaredInteractionsAnswerCorrectly,
			/no-such-mode.*was not rejected invalid_input/,
		));

	test("for an invalid answer that still resolves the ask", () =>
		fails(
			breakSessions((session) => {
				const asked = new Map<string, Interaction>();
				const control = session.control;
				if (!control) return session;
				return {
					...session,
					control: {
						...control,
						answer: async (answer) => {
							const pending = session
								.snapshot()
								.interactions.find((candidate) => candidate.id === answer.interactionId);
							if (pending) asked.set(pending.id, pending);
							const known = asked.get(answer.interactionId);
							if (!known || answerProblem(known, answer) === undefined) return control.answer(answer);
							if (pending) {
								await control.answer({ interactionId: pending.id, reply: { kind: "cancel", stopRun: false } });
							}
							return { status: "rejected", rejection: { code: "invalid_input", message: "checked too late" } };
						},
					},
				};
			}),
			declaredInteractionsAnswerCorrectly,
			/an invalid answer resolved the interaction/,
		));

	test("for a valid answer that is rejected", () =>
		fails(
			breakSessions((session) => {
				const control = session.control;
				if (!control) return session;
				return {
					...session,
					control: {
						...control,
						answer: async (answer) => {
							const pending = session
								.snapshot()
								.interactions.find((candidate) => candidate.id === answer.interactionId);
							const valid = pending !== undefined && answerProblem(pending, answer) === undefined;
							return valid && answer.reply.kind !== "cancel" ? refused : control.answer(answer);
						},
					},
				};
			}),
			declaredInteractionsAnswerCorrectly,
			/a valid answer was rejected/,
		));

	test("for an answer resolved for the wrong reason", () =>
		fails(
			breakStream((item) =>
				item.event.type === "interaction_resolved" && item.event.reason === "answered"
					? [{ ...item, event: { ...item.event, reason: "withdrawn" } }]
					: [item],
			),
			declaredInteractionsAnswerCorrectly,
			/resolved withdrawn, expected answered/,
		));

	test("for an interaction resolved twice", () =>
		fails(
			breakStream((item) => (item.event.type === "interaction_resolved" ? [item, item] : [item])),
			declaredInteractionsAnswerCorrectly,
			/resolved twice/,
		));

	test("for a repeat answer that is not stale", () =>
		fails(
			breakSessions((session) => {
				const control = session.control;
				if (!control) return session;
				return {
					...session,
					control: {
						...control,
						answer: async (answer) => {
							const result = await control.answer(answer);
							return result.status === "rejected" && result.rejection.code === "stale"
								? { status: "rejected", rejection: { code: "not_found", message: "gone" } }
								: result;
						},
					},
				};
			}),
			declaredInteractionsAnswerCorrectly,
			/a second answer must be stale/,
		));

	test("for a run aborted after a valid answer", () =>
		fails(
			breakSessions((session) => {
				const control = session.control;
				if (!control) return session;
				return {
					...session,
					control: {
						...control,
						answer: async (answer) => {
							const result = await control.answer(answer);
							if (result.status === "accepted" && answer.reply.kind !== "cancel") await control.abort();
							return result;
						},
					},
				};
			}),
			declaredInteractionsAnswerCorrectly,
			/the run was aborted after a valid answer/,
		));

	test("for a cancel that is rejected", () =>
		fails(
			breakSessions((session) => {
				const control = session.control;
				if (!control) return session;
				return {
					...session,
					control: {
						...control,
						answer: async (answer) => (answer.reply.kind === "cancel" ? refused : control.answer(answer)),
					},
				};
			}),
			declaredInteractionsAnswerCorrectly,
			/cancel was rejected/,
		));

	test("for a cancel that ignores stopRun", () =>
		fails(
			breakSessions((session) => {
				const control = session.control;
				if (!control) return session;
				return {
					...session,
					control: {
						...control,
						answer: (answer) =>
							control.answer(
								answer.reply.kind === "cancel" ? { ...answer, reply: { ...answer.reply, stopRun: false } } : answer,
							),
					},
				};
			}),
			declaredInteractionsAnswerCorrectly,
			/cancel with stopRun true ended the run completed/,
		));

	test("for an abort that expires the pending ask instead of withdrawing it", () =>
		fails(
			breakStream((item) =>
				item.event.type === "interaction_resolved" && item.event.reason === "withdrawn"
					? [{ ...item, event: { ...item.event, reason: "expired" } }]
					: [item],
			),
			declaredInteractionsAnswerCorrectly,
			/resolved expired, expected withdrawn/,
		));

	test("for an aborted run reported as completed", () =>
		fails(
			breakBackend((backend) => ({
				open: async (target, sink) => {
					let aborting = false;
					const opened = await backend.open(target, {
						emit: (item) =>
							sink.emit(
								aborting && item.event.type === "run_finished"
									? { ...item, event: { ...item.event, outcome: { kind: "completed" } } }
									: item,
							),
					});
					if (opened.status === "rejected" || !opened.session.control) return opened;
					const control = opened.session.control;
					const abort = () => {
						aborting = true;
						return control.abort();
					};
					return { ...opened, session: { ...opened.session, control: { ...control, abort } } };
				},
			})),
			declaredInteractionsAnswerCorrectly,
			/an aborted run ended completed/,
		));

	test("for a pending interaction missing from snapshot()", () =>
		fails(
			breakSessions((session) => ({ ...session, snapshot: () => ({ ...session.snapshot(), interactions: [] }) })),
			declaredInteractionsAnswerCorrectly,
			/pending interaction is not in snapshot\(\)/,
		));

	test("for a driver that asks the wrong kind", () =>
		fails(
			breakDriver((driver) => ({
				arrange: (session, scenario) =>
					driver.arrange(
						session,
						scenario.kind === "interaction" ? { kind: "interaction", interaction: "confirm" } : scenario,
					),
			})),
			declaredInteractionsAnswerCorrectly,
			/asked a confirm, not a tool_permission/,
		));

	test("for a run that ends without the ask it was arranged to raise, with why the driver says", () =>
		fails(
			breakDriver((driver) => ({
				arrange: (session, scenario) =>
					driver.arrange(session, scenario.kind === "interaction" ? { kind: "reply" } : scenario),
				unasked: async () => "the agent's own policy ran the tool",
			})),
			declaredInteractionsAnswerCorrectly,
			/tool_permission: the run ended completed without asking: the agent's own policy ran the tool/,
		));

	test("for a prompt that is rejected", () =>
		fails(
			breakSessions((session) =>
				session.control ? { ...session, control: { ...session.control, prompt: async () => refused } } : session,
			),
			declaredInteractionsAnswerCorrectly,
			/tool_permission: the prompt was rejected/,
		));

	test("for a cancel resolved as withdrawn", () =>
		fails(
			breakBackend((backend) => ({
				open: async (target, sink) => {
					let cancelling = false;
					const opened = await backend.open(target, {
						emit: (item) =>
							sink.emit(
								cancelling && item.event.type === "interaction_resolved"
									? { ...item, event: { ...item.event, reason: "withdrawn" } }
									: item,
							),
					});
					if (opened.status === "rejected" || !opened.session.control) return opened;
					const control = opened.session.control;
					const answer: typeof control.answer = (reply) => {
						cancelling = reply.reply.kind === "cancel";
						return control.answer(reply);
					};
					return { ...opened, session: { ...opened.session, control: { ...control, answer } } };
				},
			})),
			declaredInteractionsAnswerCorrectly,
			/resolved withdrawn, expected answered/,
		));

	test("for a declared kind the driver cannot produce", () =>
		fails(
			breakDriver((driver) => ({
				arrange: async (session, scenario) => scenario.kind !== "interaction" && driver.arrange(session, scenario),
			})),
			declaredInteractionsAnswerCorrectly,
			/cannot arrange/,
		));
});
