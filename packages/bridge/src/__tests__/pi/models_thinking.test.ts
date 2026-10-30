import { describe, expect, test } from "bun:test";
import { type Api, fauxProvider, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import { supportedLevel, thinkingSpec } from "../../backends/pi/models/thinking";
import { ThinkingSpec } from "../../contract";

type LevelMap = NonNullable<Model<Api>["thinkingLevelMap"]>;

function model(reasoning: boolean, thinkingLevelMap?: LevelMap): Model<Api> {
	const handle = fauxProvider({ models: [{ id: "m", reasoning }] });
	const made = handle.models[0];
	if (thinkingLevelMap) made.thinkingLevelMap = thinkingLevelMap;
	return made;
}

const values = (spec: ThinkingSpec) => spec.options.map((option) => option.value);

describe("thinkingSpec", () => {
	test("offers exactly the levels Pi supports for a reasoning model", () => {
		const spec = thinkingSpec(model(true), undefined);
		expect(values(spec)).toEqual(["off", "minimal", "low", "medium", "high"]);
		expect(spec.defaultValue).toBe("medium");
	});

	test("offers a model without `off` its own levels and never `off`", () => {
		const spec = thinkingSpec(model(true, { off: null }), undefined);
		expect(values(spec)).toEqual(["minimal", "low", "medium", "high"]);
		expect(spec.defaultValue).toBe("medium");
	});

	test("clamps the user's default to the model, upward first as Pi does", () => {
		const noOff = model(true, { off: null });
		expect(thinkingSpec(noOff, "off").defaultValue).toBe("minimal");
		expect(thinkingSpec(model(true), "xhigh").defaultValue).toBe("high");
		expect(thinkingSpec(model(true, { xhigh: "x-high" }), "xhigh").defaultValue).toBe("xhigh");
		expect(thinkingSpec(model(true), "high").defaultValue).toBe("high");
	});

	test("a model that can only think `off` has no thinking to set", () => {
		expect(thinkingSpec(model(false), "high")).toEqual({ options: [] });
		const allNull: LevelMap = { minimal: null, low: null, medium: null, high: null };
		expect(getSupportedThinkingLevels(model(true, allNull))).toEqual(["off"]);
		expect(thinkingSpec(model(true, allNull), undefined)).toEqual({ options: [] });
		expect(thinkingSpec(model(true, { ...allNull, off: null }), undefined)).toEqual({ options: [] });
	});

	test("a model with a single level, whichever it is, has nothing to choose", () => {
		const onlyHigh: LevelMap = { off: null, minimal: null, low: null, medium: null };
		expect(getSupportedThinkingLevels(model(true, onlyHigh))).toEqual(["high"]);
		expect(thinkingSpec(model(true, onlyHigh), undefined)).toEqual({ options: [] });
		expect(supportedLevel(model(true, onlyHigh), "high")).toBeUndefined();
	});

	test("offers `xhigh` and `max` only where the model maps them", () => {
		expect(values(thinkingSpec(model(true, { xhigh: "x", max: "m" }), undefined))).toEqual([
			"off",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});

	test("every spec is a valid contract ThinkingSpec whose default is one of its options", () => {
		const models = [model(false), model(true), model(true, { off: null }), model(true, { xhigh: "x" })];
		for (const made of models) {
			const spec = thinkingSpec(made, "medium");
			expect(ThinkingSpec.safeParse(spec).success).toBe(true);
			if (spec.defaultValue !== undefined) expect(values(spec)).toContain(spec.defaultValue);
		}
	});
});

describe("supportedLevel", () => {
	test("accepts exactly the values thinkingSpec offers", () => {
		const models = [model(false), model(true), model(true, { off: null }), model(true, { xhigh: "x", max: "m" })];
		const every = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "bogus", ""];
		for (const made of models) {
			const offered = values(thinkingSpec(made, undefined));
			for (const value of every) {
				expect<string | undefined>(supportedLevel(made, value)).toBe(offered.includes(value) ? value : undefined);
			}
		}
	});

	test("refuses `off` on a model that cannot do without it and on one that cannot think", () => {
		expect(supportedLevel(model(true, { off: null }), "off")).toBeUndefined();
		expect(supportedLevel(model(false), "off")).toBeUndefined();
		expect(supportedLevel(model(true), "off")).toBe("off");
	});
});
