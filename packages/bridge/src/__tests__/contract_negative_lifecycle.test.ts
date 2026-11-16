import { describe, test } from "bun:test";
import type { AgentBackend, OpenResult, OpenSession } from "../contract/backend";
import type { TranscriptReadResult } from "../contract/read-results";
import { emptySnapshot } from "../contract/session-reducer";
import {
	closeDetachesWithoutAborting,
	disposeSilencesEverything,
	externalRunsAreLive,
	sessionsSurviveARestart,
	snapshotsMatchTheEvents,
} from "../contract/testing/rules-lifecycle";
import {
	breakBackend,
	breakCatalog,
	breakControl,
	breakDriver,
	breakOpen,
	breakSessions,
	breakStream,
	fails,
	honest,
	record,
	refused,
} from "./helpers/broken-adapters";

describe("the snapshot rule fails", () => {
	test("for a snapshot that forgets the live state", () =>
		fails(
			breakSessions((session) => ({ ...session, snapshot: emptySnapshot })),
			snapshotsMatchTheEvents,
			/differs from the events applied/,
		));

	test("for an active run that does not carry its prompt", () =>
		fails(
			breakControl((control) => ({
				prompt: (input) => control.prompt({ ...input, clientRequestId: crypto.randomUUID() }),
			})),
			snapshotsMatchTheEvents,
			/the active run does not carry its prompt/,
		));

	test("for a transcript that holds the active run", () =>
		fails(
			breakBackend((backend) => {
				const prompts: string[] = [];
				return {
					open: async (target, sink) => {
						const opened = await backend.open(target, sink);
						if (opened.status === "rejected" || !opened.session.control) return opened;
						const control = opened.session.control;
						const prompt: typeof control.prompt = (input) => {
							prompts.push(input.clientRequestId);
							return control.prompt(input);
						};
						return { ...opened, session: { ...opened.session, control: { ...control, prompt } } };
					},
					readTranscript: async (session, page): Promise<TranscriptReadResult> => {
						const read = await backend.readTranscript(session, page);
						if (read.status === "rejected") return read;
						const echoes = prompts.map((id) => ({
							kind: "user_message" as const,
							id: `echo-${id}`,
							text: "",
							attachments: [],
							clientRequestId: id,
						}));
						return { ...read, page: { ...read.page, items: [...echoes, ...read.page.items] } };
					},
				};
			}),
			snapshotsMatchTheEvents,
			/the transcript holds the active run/,
		));

	test("for a reopen that loses what the run has finished", () =>
		fails(
			breakOpen((opened, target) =>
				target.kind === "existing" && opened.snapshot.run
					? { ...opened, snapshot: { ...opened.snapshot, run: { ...opened.snapshot.run, items: [] } } }
					: opened,
			),
			snapshotsMatchTheEvents,
			/reopening gives a different live state/,
		));

	test("for a reopen with other capabilities", () =>
		fails(
			breakSessions((session, target) => {
				if (target.kind !== "existing" || !session.control) return session;
				const { compact: _compact, ...control } = session.control;
				return { ...session, control };
			}),
			snapshotsMatchTheEvents,
			/capabilities changed/,
		));

	test("for a finished run that never reaches the transcript", () =>
		fails(
			breakBackend((backend) => ({
				readTranscript: async (session, page) => {
					const read = await backend.readTranscript(session, page);
					return read.status === "accepted"
						? { ...read, page: { ...read.page, items: read.page.items.filter((item) => item.kind !== "user_message") } }
						: read;
				},
			})),
			snapshotsMatchTheEvents,
			/the finished run is not in the transcript/,
		));
});

describe("the close rule fails", () => {
	test("for a close that throws the second time", () =>
		fails(
			breakSessions((session) => {
				let closed = false;
				return {
					...session,
					close: async () => {
						if (closed) throw new Error("already closed");
						closed = true;
						await session.close();
					},
				};
			}),
			closeDetachesWithoutAborting,
			/already closed/,
		));

	test("for a close that closes nothing", () =>
		fails(
			breakSessions((session) => ({ ...session, close: async () => {} })),
			closeDetachesWithoutAborting,
			/a closed session must reject/,
		));

	test("for events after close", () =>
		fails(
			breakBackend((backend) => ({
				open: async (target, sink) => {
					const opened = await backend.open(target, sink);
					if (opened.status === "rejected") return opened;
					const close = async () => {
						await opened.session.close();
						queueMicrotask(() => sink.emit(record({ type: "notice", level: "info", text: "still here" })));
					};
					return { ...opened, session: { ...opened.session, close } };
				},
			})),
			closeDetachesWithoutAborting,
			/events arrived after close/,
		));

	test("for a close that aborts the run", () =>
		fails(
			breakBackend((backend) => ({
				open: async (target, sink) => {
					const opened = await backend.open(target, sink);
					if (opened.status === "rejected") return opened;
					const close = async () => {
						await opened.session.close();
						const ref = opened.session.session;
						const killer = await backend.open({ kind: "existing", session: ref }, { emit: () => {} });
						if (killer.status === "accepted") await killer.session.control?.abort();
					};
					return { ...opened, session: { ...opened.session, close } };
				},
			})),
			closeDetachesWithoutAborting,
			/closing the session ended its run/,
		));

	test("for a pending ask that does not outlive close", () =>
		fails(
			breakOpen((opened, target) =>
				target.kind === "existing" ? { ...opened, snapshot: { ...opened.snapshot, interactions: [] } } : opened,
			),
			closeDetachesWithoutAborting,
			/not in the next open's snapshot/,
		));

	test("for a pending ask that cannot be answered after reopening", () =>
		fails(
			breakSessions((session, target) =>
				target.kind === "existing" && session.control
					? { ...session, control: { ...session.control, answer: async () => refused } }
					: session,
			),
			closeDetachesWithoutAborting,
			/cannot be answered after reopening/,
		));

	test("for a reopened ask resolved for the wrong reason", () =>
		fails(
			breakStream((item) =>
				item.event.type === "interaction_resolved"
					? [{ ...item, event: { ...item.event, reason: "withdrawn" } }]
					: [item],
			),
			closeDetachesWithoutAborting,
			/the reopened ask resolved withdrawn/,
		));
});

describe("the dispose rule fails", () => {
	test("for a dispose that leaves sinks attached", () =>
		fails(
			breakBackend(() => ({ dispose: async () => {} })),
			disposeSilencesEverything,
			/emitted after dispose/,
		));

	test("for a catalog that goes on after dispose", () =>
		fails(breakInstanceCatalogAfterDispose(), disposeSilencesEverything, /the catalog emitted after dispose/));
});

/** Disposes, then tells the catalog about a session anyway. */
function breakInstanceCatalogAfterDispose() {
	return async (host: Parameters<ReturnType<typeof honest>>[0]) => {
		const instance = await honest()(host);
		const backend = instance.backend;
		return {
			...instance,
			backend: {
				...backend,
				dispose: async () => {
					await backend.dispose();
					const listed = await backend.listSessions({}, { limit: 1 });
					const [row] = listed.status === "accepted" ? listed.page.items : [];
					if (row) queueMicrotask(() => host.catalog.emit({ type: "session_updated", summary: row }));
				},
			},
		};
	};
}

describe("the external run rule fails", () => {
	test("when no other client can run", () =>
		fails(
			breakDriver(() => ({ runExternally: async () => false })),
			externalRunsAreLive,
			/no other client can run/,
		));

	test("for another client's run with the wrong trigger", () =>
		fails(
			breakStream((item) =>
				item.event.type === "run_started" ? [{ ...item, event: { ...item.event, trigger: "prompt" } }] : [item],
			),
			externalRunsAreLive,
			/started with trigger prompt/,
		));

	test("for another client's run that is never reported", () =>
		fails(
			breakStream(() => []),
			externalRunsAreLive,
			/timed out .* run_started/,
		));
});

describe("the restart rule fails", () => {
	test("for a session lost in a restart", () =>
		fails(
			breakDriver((driver) => ({
				restart: async (host) => {
					const next = await driver.restart(host);
					return { ...next, getSession: async () => refused };
				},
			})),
			sessionsSurviveARestart,
			/did not survive a restart/,
		));

	test("for a run that survives a restart", () =>
		fails(
			breakDriver((driver) => ({
				restart: async (host) => {
					const next = await driver.restart(host);
					return {
						...next,
						open: async (target, sink) => {
							const opened = await next.open(target, sink);
							const run = { runId: "survivor", trigger: "prompt" as const, startedAt: 0, items: [], droppedItems: 0 };
							return opened.status === "accepted" ? { ...opened, snapshot: { ...opened.snapshot, run } } : opened;
						},
					};
				},
			})),
			sessionsSurviveARestart,
			/a run survived the restart/,
		));
});

describe("the restart rule fails, where runs outlive the bridge,", () => {
	const surviving = honest({ runsSurviveRestart: true });

	/** Breaks the backend the restart starts, which `breakBackend` never reaches. */
	const afterRestart = (change: (backend: AgentBackend) => Partial<AgentBackend>) =>
		breakDriver(
			(driver) => ({
				restart: async (host) => {
					const next = await driver.restart(host);
					return { ...next, ...change(next) };
				},
			}),
			surviving,
		);
	const reopenedAs = (change: (opened: Extract<OpenResult, { status: "accepted" }>) => OpenResult) =>
		afterRestart((next) => ({
			open: async (target, sink) => {
				const opened = await next.open(target, sink);
				return opened.status === "accepted" ? change(opened) : opened;
			},
		}));
	const reopenedSession = (change: (session: OpenSession) => OpenSession) =>
		reopenedAs((opened) => ({ ...opened, session: change(opened.session) }));

	test("for a run that ends with the bridge", () =>
		fails(
			reopenedAs((opened) => {
				const { run: _run, ...snapshot } = opened.snapshot;
				return { ...opened, snapshot };
			}),
			sessionsSurviveARestart,
			/a run did not survive the restart/,
		));

	test("for a run that keeps its RunId", () => {
		const first: string[] = [];
		const remembering = breakStream((record) => {
			if (record.event.type === "run_started") first.push(record.event.runId);
			return [record];
		}, surviving);
		return fails(
			breakDriver(
				(driver) => ({
					restart: async (host) => {
						const next = await driver.restart(host);
						return {
							...next,
							open: async (target, sink) => {
								const opened = await next.open(target, sink);
								const [runId] = first;
								if (opened.status === "rejected" || !opened.snapshot.run || runId === undefined) return opened;
								return { ...opened, snapshot: { ...opened.snapshot, run: { ...opened.snapshot.run, runId } } };
							},
						};
					},
				}),
				remembering,
			),
			sessionsSurviveARestart,
			/kept its RunId/,
		);
	});

	test("for a run that lost its prompt", () =>
		fails(
			reopenedAs((opened) => {
				const run = opened.snapshot.run;
				if (!run) return opened;
				const items = run.items.filter((item) => item.kind !== "user_message");
				return { ...opened, snapshot: { ...opened.snapshot, run: { ...run, items } } };
			}),
			sessionsSurviveARestart,
			/lost its prompt/,
		));

	test("for a run that cannot be stopped", () =>
		fails(
			reopenedSession((session) =>
				session.control ? { ...session, control: { ...session.control, abort: async () => refused } } : session,
			),
			sessionsSurviveARestart,
			/abort was rejected/,
		));

	test("for an ask lost in the restart", () =>
		fails(
			reopenedAs((opened) => ({ ...opened, snapshot: { ...opened.snapshot, interactions: [] } })),
			sessionsSurviveARestart,
			/not in the reopened snapshot/,
		));

	test("for an ask that cannot be answered after it", () =>
		fails(
			reopenedSession((session) =>
				session.control ? { ...session, control: { ...session.control, answer: async () => refused } } : session,
			),
			sessionsSurviveARestart,
			/cannot be answered after it/,
		));
});

describe("catalog events", () => {
	test("are checked as they arrive", () =>
		fails(
			breakCatalog((event) =>
				event.type === "session_updated" ? [{ ...event, summary: { ...event.summary, updatedAt: -1 } }] : [event],
			),
			snapshotsMatchTheEvents,
			/an invalid catalog event/,
		));
});
