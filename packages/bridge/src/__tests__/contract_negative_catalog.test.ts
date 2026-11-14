import { describe, test } from "bun:test";
import type { ModelSummary } from "../contract/models";
import {
	capabilitiesMatchTheBackend,
	commandsAreListed,
	modelsAreConsistent,
	modesAreConsistent,
} from "../contract/testing/rules-catalog";
import { breakBackend, fails, refused } from "./helpers/broken-adapters";

function withModels(change: (models: ModelSummary[]) => ModelSummary[]) {
	return breakBackend((backend) => ({
		listModels: async (cwd) => {
			const listed = await backend.listModels(cwd);
			return listed.status === "accepted" ? { ...listed, models: change(listed.models) } : listed;
		},
	}));
}

function withAllModels(change: (models: ModelSummary[]) => ModelSummary[]) {
	return breakBackend((backend) => ({
		listModels: async (cwd, options) => {
			const listed = await backend.listModels(cwd, options);
			return listed.status === "accepted" && options?.includeUnavailable
				? { ...listed, models: change(listed.models) }
				: listed;
		},
	}));
}

const NEEDS_A_KEY: ModelSummary = {
	id: "missing/needs-a-key",
	displayName: "Needs a key",
	thinking: { options: [] },
	isDefault: false,
};

describe("the capability rule fails", () => {
	test("for traits without start", () =>
		fails(
			breakBackend((backend) => ({ traits: { ...backend.traits, promptModes: ["steer", "queue"] } })),
			capabilitiesMatchTheBackend,
			/capabilities are not valid.*every backend takes start/s,
		));

	test("for a trait list that repeats a value", () =>
		fails(
			breakBackend((backend) => ({ traits: { ...backend.traits, promptModes: ["start", "start"] } })),
			capabilitiesMatchTheBackend,
			/capabilities are not valid.*listed twice/s,
		));

	test("for an invalid status", () =>
		fails(
			breakBackend((backend) => ({
				status: async () => ({ ...(await backend.status()), issues: [{ severity: "error", message: "" }] }),
			})),
			capabilitiesMatchTheBackend,
			/status\(\) is not a valid BackendStatus/,
		));
});

describe("the model rule fails", () => {
	test("for a rejected listing", () =>
		fails(
			breakBackend(() => ({ listModels: async () => refused })),
			modelsAreConsistent,
			/listModels was rejected/,
		));

	test("for an invalid model", () =>
		fails(
			withModels((models) => models.map((model) => ({ ...model, displayName: "" }))),
			modelsAreConsistent,
			/model list is not valid/,
		));

	test("for an unavailable model in the plain list", () =>
		fails(
			withModels((models) => models.map((model) => ({ ...model, unavailableReason: "no key" }))),
			modelsAreConsistent,
			/unavailableReason is listed without includeUnavailable/,
		));

	test("for an unavailable model that does not say why", () =>
		fails(
			withAllModels((models) => [...models, NEEDS_A_KEY]),
			modelsAreConsistent,
			/must say why it is unavailable/,
		));

	test("for an unavailable model listed before the usable ones", () =>
		fails(
			withAllModels((models) => [{ ...NEEDS_A_KEY, unavailableReason: "no key" }, ...models]),
			modelsAreConsistent,
			/usable models first/,
		));

	test("for an includeUnavailable list that is not valid", () =>
		fails(
			withAllModels((models) => models.map((model) => ({ ...model, displayName: "" }))),
			modelsAreConsistent,
			/model list with includeUnavailable is not valid/,
		));

	test("for an includeUnavailable list that is refused", () =>
		fails(
			breakBackend((backend) => ({
				listModels: async (cwd, options) => (options?.includeUnavailable ? refused : backend.listModels(cwd, options)),
			})),
			modelsAreConsistent,
			/with includeUnavailable was rejected/,
		));

	test("for no models", () =>
		fails(
			withModels(() => []),
			modelsAreConsistent,
			/returned no models/,
		));

	test("for a repeated model id", () =>
		fails(
			withModels((models) => [...models, ...models.slice(0, 1).map((model) => ({ ...model, isDefault: false }))]),
			modelsAreConsistent,
			/model ids repeat/,
		));

	test("for two defaults", () =>
		fails(
			withModels((models) => models.map((model) => ({ ...model, isDefault: true }))),
			modelsAreConsistent,
			/more than one default/,
		));

	test("for a repeated thinking option", () =>
		fails(
			withModels((models) =>
				models.map((model) => ({ ...model, thinking: { options: [{ value: "x" }, { value: "x" }] } })),
			),
			modelsAreConsistent,
			/thinking option repeats/,
		));

	test("for a default thinking that is not an option", () =>
		fails(
			withModels((models) =>
				models.map((model) => ({ ...model, thinking: { ...model.thinking, defaultValue: "odd" } })),
			),
			modelsAreConsistent,
			/default thinking is not an option/,
		));

	test("for thinking options without the thinking capability", () =>
		fails(
			breakBackend((backend) => ({ traits: { ...backend.traits, thinking: false } })),
			modelsAreConsistent,
			/thinking options without the thinking capability/,
		));
});

describe("the command rule fails", () => {
	test("for a rejected listing", () =>
		fails(
			breakBackend(() => ({ listCommands: async () => refused })),
			commandsAreListed,
			/listCommands was rejected/,
		));

	test("for an invalid command", () =>
		fails(
			breakBackend(() => ({
				listCommands: async () => ({ status: "accepted", commands: [{ id: "/x", name: "", kind: "command" }] }),
			})),
			commandsAreListed,
			/command list is not valid/,
		));

	test("for a repeated command id", () =>
		fails(
			breakBackend(() => ({
				listCommands: async () => ({
					status: "accepted",
					commands: [
						{ id: "/x", name: "x", kind: "command" },
						{ id: "/x", name: "y", kind: "command" },
					],
				}),
			})),
			commandsAreListed,
			/command ids repeat/,
		));

	test("for declared commands that are never listed", () =>
		fails(
			breakBackend(() => ({ listCommands: async () => ({ status: "accepted", commands: [] }) })),
			commandsAreListed,
			/declared but none is listed/,
		));

	test("for commands listed without the capability", () =>
		fails(
			breakBackend((backend) => ({ traits: { ...backend.traits, commands: false } })),
			commandsAreListed,
			/listed by a backend without commands/,
		));
});

describe("the mode rule fails", () => {
	test("for a rejected listing", () =>
		fails(
			breakBackend(() => ({ listModes: async () => refused })),
			modesAreConsistent,
			/listModes was rejected/,
		));

	test("for a mode without options", () =>
		fails(
			breakBackend(() => ({
				listModes: async () => ({ status: "accepted", modes: [{ id: "a", label: "A", options: [] }] }),
			})),
			modesAreConsistent,
			/mode list is not valid/,
		));

	test("for a repeated mode id", () =>
		fails(
			breakBackend(() => ({
				listModes: async () => ({
					status: "accepted",
					modes: [
						{ id: "a", label: "A", options: [{ value: "1", label: "1" }] },
						{ id: "a", label: "B", options: [{ value: "1", label: "1" }] },
					],
				}),
			})),
			modesAreConsistent,
			/mode ids repeat/,
		));

	test("for a repeated option", () =>
		fails(
			breakBackend(() => ({
				listModes: async () => ({
					status: "accepted",
					modes: [
						{
							id: "a",
							label: "A",
							options: [
								{ value: "1", label: "1" },
								{ value: "1", label: "one" },
							],
						},
					],
				}),
			})),
			modesAreConsistent,
			/an option repeats/,
		));

	test("for a default that is not an option", () =>
		fails(
			breakBackend(() => ({
				listModes: async () => ({
					status: "accepted",
					modes: [{ id: "a", label: "A", options: [{ value: "1", label: "1" }], defaultValue: "2" }],
				}),
			})),
			modesAreConsistent,
			/the default is not an option/,
		));
});
