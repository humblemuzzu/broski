import { describe, test } from "bun:test";
import { MINIMAL_TRAITS } from "../contract/testing/fake-data";
import { compactionRuns, modelAndThinkingCanBeSet, modesCanBeSet } from "../contract/testing/rules-settings";
import {
	accepted,
	breakBackend,
	breakControl,
	breakOpen,
	breakStream,
	fails,
	honest,
	refused,
} from "./helpers/broken-adapters";

describe("the model rule fails", () => {
	test("for a model choice that is rejected", () =>
		fails(
			breakControl(() => ({ setModel: async () => refused })),
			modelAndThinkingCanBeSet,
			/choosing fake-large was rejected/,
		));

	test("for a model choice that changes nothing", () =>
		fails(
			breakControl(() => ({ setModel: async () => accepted })),
			modelAndThinkingCanBeSet,
			/timed out .* model_changed/,
		));

	test("for a thinking value that is rejected", () =>
		fails(
			breakControl(() => ({ setThinking: async () => refused })),
			modelAndThinkingCanBeSet,
			/fake-large: low was rejected/,
		));

	test("for a thinking value that changes nothing", () =>
		fails(
			breakControl(() => ({ setThinking: async () => accepted })),
			modelAndThinkingCanBeSet,
			/timed out .* model_changed/,
		));

	test("for a thinking value off the list that is accepted", () =>
		fails(
			breakControl((control) => ({
				setThinking: async (value) => {
					const result = await control.setThinking(value);
					return result.status === "rejected" ? accepted : result;
				},
			})),
			modelAndThinkingCanBeSet,
			/a thinking value it does not offer was accepted/,
		));

	test("for an unknown model that is not not_found", () =>
		fails(
			breakControl((control) => ({
				setModel: async (model) => {
					const result = await control.setModel(model);
					return result.status === "rejected" ? refused : result;
				},
			})),
			modelAndThinkingCanBeSet,
			/unknown model must be not_found/,
		));

	test("for a new session that ignores the model asked for", () =>
		fails(
			breakBackend((backend) => ({
				open: (target, sink) =>
					backend.open(
						target.kind === "new"
							? { kind: "new", options: { cwd: target.options.cwd, modelId: "fake-small" } }
							: target,
						sink,
					),
			})),
			modelAndThinkingCanBeSet,
			/the first request ran with fake-small, not fake-large/,
		));

	test("for a model choice refused mid-run", () =>
		fails(
			breakOpen((opened) => {
				const control = opened.session.control;
				if (!control) return opened;
				const setModel = async (modelId: string) =>
					opened.session.snapshot().run ? refused : control.setModel(modelId);
				return { ...opened, session: { ...opened.session, control: { ...control, setModel } } };
			}),
			modelAndThinkingCanBeSet,
			/choosing fake-small mid-run was rejected/,
		));

	test("for a model echo run that does not complete", () =>
		fails(
			breakStream((item) =>
				item.event.type === "run_finished"
					? [{ ...item, event: { ...item.event, outcome: { kind: "limit", limit: "max_turns" } } }]
					: [item],
			),
			modelAndThinkingCanBeSet,
			/the run ended limit/,
		));

	test("for a model choice the next run does not use", () =>
		fails(
			breakOpen(
				(opened) => {
					const control = opened.session.control;
					if (!control) return opened;
					const setModel = async (modelId: string) => {
						const result = await control.setModel(modelId);
						if (modelId !== "fake-small") return result;
						await opened.session.control?.setModel("fake-large");
						return result;
					};
					return { ...opened, session: { ...opened.session, control: { ...control, setModel } } };
				},
				honest({ traits: MINIMAL_TRAITS }),
			),
			modelAndThinkingCanBeSet,
			/the next run ran with fake-large, not fake-small/,
		));
});

describe("the mode rule fails", () => {
	test("for a snapshot without a value for every mode", () =>
		fails(
			breakOpen((opened) => ({ ...opened, snapshot: { ...opened.snapshot, modes: [] } })),
			modesCanBeSet,
			/holds 0 values for mode permissions/,
		));

	test("for a new session that ignores the modes asked for", () =>
		fails(
			breakBackend((backend) => ({
				open: (target, sink) =>
					backend.open(target.kind === "new" ? { kind: "new", options: { cwd: target.options.cwd } } : target, sink),
			})),
			modesCanBeSet,
			/mode permissions did not start at all/,
		));

	test("for a mode choice that is rejected", () =>
		fails(
			breakControl(() => ({ setMode: async () => refused })),
			modesCanBeSet,
			/permissions=ask was rejected/,
		));

	test("for a mode choice that changes nothing", () =>
		fails(
			breakControl(() => ({ setMode: async () => accepted })),
			modesCanBeSet,
			/timed out .* mode_changed/,
		));

	test("for a value off the list that is accepted", () =>
		fails(
			breakControl((control) => ({
				setMode: async (axis, value) => {
					const result = await control.setMode(axis, value);
					return result.status === "rejected" && axis !== "not-a-mode" ? accepted : result;
				},
			})),
			modesCanBeSet,
			/a value it does not offer must be invalid_input/,
		));

	test("for an unknown mode that is accepted", () =>
		fails(
			breakControl((control) => ({
				setMode: async (axis, value) => (axis === "not-a-mode" ? accepted : control.setMode(axis, value)),
			})),
			modesCanBeSet,
			/an unknown mode must be invalid_input/,
		));
});

describe("the compaction rule fails", () => {
	test("for a compaction that is rejected", () =>
		fails(
			breakControl(() => ({ compact: async () => refused })),
			compactionRuns,
			/compact was rejected/,
		));

	test("for a compaction that never finishes", () =>
		fails(
			breakStream((item) => (item.event.type === "compaction_finished" ? [] : [item])),
			compactionRuns,
			/timed out .* compaction_finished/,
		));

	test("for a compaction that never happens", () =>
		fails(
			breakControl(() => ({ compact: async () => accepted })),
			compactionRuns,
			/timed out .* compaction_started/,
		));
});
