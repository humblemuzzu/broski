import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { listedModelIdOf, listedRows, modelSummaries } from "../../../backends/claude-code/models/model-list";
import { thinkingSpec } from "../../../backends/claude-code/models/thinking";
import { MAX_ID_CHARS, ModelSummary } from "../../../contract";
import { FIVE_MODELS } from "./rig";

function wireOf(row: ModelInfo): string {
	return row.resolvedModel ?? row.value;
}

describe("the model list", () => {
	test("lists the rows as valid, unique contract models with exactly one default", () => {
		const models = modelSummaries(FIVE_MODELS);
		expect(models.map((model) => model.id)).toEqual(["default", "fable", "sonnet", "haiku"]);
		for (const model of models) expect(ModelSummary.safeParse(model).success).toBe(true);
		expect(models.filter((model) => model.isDefault).map((model) => model.id)).toEqual(["default"]);
		expect(models.find((model) => model.id === "sonnet")).toMatchObject({
			displayName: "Sonnet",
			description: "Sonnet description",
		});
	});

	test("keeps the CLI's order, Default first, and drops a row that runs the Default row's model (conformance rule 20)", () => {
		const rows = listedRows(FIVE_MODELS);
		expect(rows.map((row) => row.value)).toEqual(["default", "fable", "sonnet", "haiku"]);
		const [first, second] = rows;
		if (!first || !second) throw new Error("fewer than two rows");
		expect(wireOf(first)).not.toBe(wireOf(second));
		expect(new Set(rows.map(wireOf)).size).toBe(rows.length);
	});

	test("keeps two other rows that share a wire id, and every row when the CLI names no default row", () => {
		const twins: ModelInfo[] = [
			...FIVE_MODELS,
			{ value: "sonnet-latest", resolvedModel: "claude-sonnet-5-5", displayName: "S", description: "" },
		];
		expect(listedRows(twins).map((row) => row.value)).toEqual(["default", "fable", "sonnet", "haiku", "sonnet-latest"]);
		const noDefault = FIVE_MODELS.filter((row) => row.value !== "default");
		expect(listedRows(noDefault).map((row) => row.value)).toEqual(["opus", "fable", "sonnet", "haiku"]);
	});

	test("keeps the CLI's order when every row has a wire id of its own", () => {
		const distinct = FIVE_MODELS.map((row) => ({ ...row, resolvedModel: `wire-${row.value}` }));
		expect(listedRows(distinct).map((row) => row.value)).toEqual(FIVE_MODELS.map((row) => row.value));
	});

	test("treats a row without resolvedModel as its own wire id", () => {
		const rows: ModelInfo[] = [
			{ value: "a", displayName: "A", description: "" },
			{ value: "b", resolvedModel: "a", displayName: "B", description: "" },
		];
		expect(listedRows(rows).map((row) => row.value)).toEqual(["a", "b"]);
		expect(listedModelIdOf(rows, "a")).toBe("a");
		const defaulted: ModelInfo[] = [
			{ value: "default", displayName: "D", description: "" },
			{ value: "x", resolvedModel: "default", displayName: "X", description: "" },
		];
		expect(listedRows(defaulted).map((row) => row.value)).toEqual(["default"]);
	});

	test("drops repeated values and ids that cannot be ids, and omits an empty description", () => {
		const rows: ModelInfo[] = [
			{ value: "a", displayName: "A", description: "" },
			{ value: "a", displayName: "A again", description: "x" },
			{ value: "", displayName: "Empty", description: "x" },
			{ value: "x".repeat(MAX_ID_CHARS + 1), displayName: "Long", description: "x" },
		];
		const models = modelSummaries(rows);
		expect(models.map((model) => model.id)).toEqual(["a"]);
		expect(models[0]).not.toHaveProperty("description");
		expect(models[0]?.displayName).toBe("A");
	});

	test("a model without a display name is named by its id, never by an empty string", () => {
		const [model] = modelSummaries([{ value: "plain", displayName: "  ", description: "d" }]);
		expect(model?.displayName).toBe("plain");
	});
});

describe("listedModelIdOf", () => {
	test("maps a wire id to the row that resolves to it, and an alias to itself", () => {
		expect(listedModelIdOf(FIVE_MODELS, "claude-sonnet-5-5")).toBe("sonnet");
		expect(listedModelIdOf(FIVE_MODELS, "claude-fable-5-1")).toBe("fable");
		expect(listedModelIdOf(FIVE_MODELS, "haiku")).toBe("haiku");
	});

	test("the Default row's wire id goes to the Default row, the one listed for it", () => {
		expect(listedModelIdOf(FIVE_MODELS, "claude-opus-5-5")).toBe("default");
	});

	test("maps dated and context-suffixed wire ids to their listed row, and leaves retired ids undefined", () => {
		expect(listedModelIdOf(FIVE_MODELS, "claude-sonnet-5-5-20260101")).toBe("sonnet");
		expect(listedModelIdOf(FIVE_MODELS, "claude-opus-5-5[1m]")).toBe("default");
		expect(listedModelIdOf(FIVE_MODELS, "claude-opus-4-1")).toBeUndefined();
		expect(listedModelIdOf(FIVE_MODELS, "claude-opus-4-1-20250805")).toBeUndefined();
		expect(listedModelIdOf([], "claude-opus-5-5")).toBeUndefined();
	});
});

describe("thinking", () => {
	test("offers supportedEffortLevels as given, in the CLI's order, labelled", () => {
		const row = FIVE_MODELS[0];
		if (!row) throw new Error("no row");
		expect(thinkingSpec(row)).toEqual({
			options: [
				{ value: "low", label: "Low" },
				{ value: "medium", label: "Medium" },
				{ value: "high", label: "High" },
				{ value: "xhigh", label: "Extra high" },
				{ value: "max", label: "Max" },
			],
		});
	});

	test("offers nothing for a model without effort, or with no levels listed", () => {
		const base: ModelInfo = { value: "m", displayName: "M", description: "" };
		expect(thinkingSpec({ ...base, supportsEffort: false, supportedEffortLevels: ["low"] })).toEqual({ options: [] });
		expect(thinkingSpec({ ...base, supportsEffort: true })).toEqual({ options: [] });
		expect(thinkingSpec(base)).toEqual({ options: [] });
	});

	test("never repeats a level, and sets no default the CLI did not name", () => {
		const spec = thinkingSpec({
			value: "m",
			displayName: "M",
			description: "",
			supportedEffortLevels: ["low", "low", "high"],
		});
		expect(spec.options.map((option) => option.value)).toEqual(["low", "high"]);
		expect(spec.defaultValue).toBeUndefined();
	});
});
