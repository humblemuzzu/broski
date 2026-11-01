import { describe, test } from "bun:test";
import { answerProblem } from "../contract/answer-check";
import type { OpenSession, SessionControl } from "../contract/backend";
import type { InteractionAnswer } from "../contract/interaction-replies";
import type { Interaction } from "../contract/interactions";
import { watchedAsksAreAnsweredOnce } from "../contract/testing/rules-watched-asks";
import { accepted, breakOpen, breakSessions, breakStream, fails, refused } from "./helpers/broken-adapters";

const refusing: SessionControl = {
	prompt: async () => refused,
	abort: async () => refused,
	answer: async () => refused,
	setModel: async () => refused,
	setThinking: async () => refused,
	setMode: async () => refused,
};

/** The watched session, with its `answer` replaced by what `change` makes of it. */
function breakWatchedAnswer(change: (session: OpenSession, answer: NonNullable<OpenSession["answer"]>) => OpenSession) {
	return breakSessions((session) => {
		if (!session.answer) return session;
		const original = session.answer.bind(session);
		return change(session, original);
	});
}

function pendingIn(session: OpenSession, answer: InteractionAnswer) {
	return session.snapshot().interactions.find((candidate) => candidate.id === answer.interactionId);
}

describe("the watched-ask rule fails", () => {
	test("for a session with control that offers a second way to answer", () =>
		fails(
			breakSessions((session) => (session.control ? { ...session, answer: session.control.answer } : session)),
			watchedAsksAreAnsweredOnce,
			/a session with control offers a second way to answer/,
		));

	test("for a watched session that can be controlled", () =>
		fails(
			breakSessions((session) => (session.control ? session : { ...session, control: refusing })),
			watchedAsksAreAnsweredOnce,
			/the watched session another client asked in can be controlled/,
		));

	test("for a watched session that takes no answers", () =>
		fails(
			breakSessions(({ answer: _answer, ...session }) => session),
			watchedAsksAreAnsweredOnce,
			/the watched session takes no answers/,
		));

	test("for a watched session whose ask never comes", () =>
		fails(
			breakOpen((opened) => ({
				...opened,
				snapshot: { ...opened.snapshot, interactions: [] },
			})),
			watchedAsksAreAnsweredOnce,
			/waiting for interaction_requested/,
		));

	test("for an answer accepted without checking it", () =>
		fails(
			breakWatchedAnswer((session, answer) => ({
				...session,
				answer: async (reply) => {
					const pending = pendingIn(session, reply);
					return pending && answerProblem(pending, reply) !== undefined ? accepted : answer(reply);
				},
			})),
			watchedAsksAreAnsweredOnce,
			/watched: the invalid answer .* was not rejected invalid_input/,
		));

	test("for an invalid answer that resolves the ask", () =>
		fails(
			breakWatchedAnswer((session, answer) => {
				const asked = new Map<string, Interaction>();
				return {
					...session,
					answer: async (reply) => {
						const pending = asked.get(reply.interactionId) ?? pendingIn(session, reply);
						if (!pending || answerProblem(pending, reply) === undefined) return answer(reply);
						asked.set(pending.id, pending);
						await answer({
							interactionId: reply.interactionId,
							reply: { kind: "cancel", stopRun: false },
						});
						return {
							status: "rejected",
							rejection: { code: "invalid_input", message: "no" },
						};
					},
				};
			}),
			watchedAsksAreAnsweredOnce,
			/watched: an invalid answer resolved the interaction/,
		));

	test("for a valid answer refused", () =>
		fails(
			breakWatchedAnswer((session, answer) => ({
				...session,
				answer: async (reply) => {
					const pending = pendingIn(session, reply);
					return pending && answerProblem(pending, reply) === undefined ? refused : answer(reply);
				},
			})),
			watchedAsksAreAnsweredOnce,
			/watched: a valid answer was rejected/,
		));

	test("for an ask that resolves as anything but answered", () =>
		fails(
			breakStream((record) =>
				record.event.type === "interaction_resolved"
					? [{ ...record, event: { ...record.event, reason: "withdrawn" } }]
					: [record],
			),
			watchedAsksAreAnsweredOnce,
			/watched: the ask resolved withdrawn, expected answered/,
		));

	test("for a second answer that is not stale", () =>
		fails(
			breakWatchedAnswer((session, answer) => ({
				...session,
				answer: async (reply) => {
					const result = await answer(reply);
					return result.status === "rejected" && result.rejection.code === "stale" ? accepted : result;
				},
			})),
			watchedAsksAreAnsweredOnce,
			/watched: a second answer must be stale/,
		));

	test("for an answer after close that is not refused closed", () =>
		fails(
			breakWatchedAnswer((session, answer) => ({
				...session,
				answer: async (reply) => {
					const result = await answer(reply);
					return result.status === "rejected" && result.rejection.code === "closed"
						? {
								status: "rejected",
								rejection: { code: "stale", message: "gone" },
							}
						: result;
				},
			})),
			watchedAsksAreAnsweredOnce,
			/an answer after close must be rejected closed/,
		));
});
