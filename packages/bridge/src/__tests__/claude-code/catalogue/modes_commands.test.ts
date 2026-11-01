import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { commandsOf } from "../../../backends/claude-code/commands";
import { permissionsAxis } from "../../../backends/claude-code/modes";
import { PERMISSION_MODES } from "../../../backends/claude-code/permission-modes";
import { mayBypassPermissions } from "../../../backends/claude-code/process/bypass";
import { CommandSummary, MAX_ID_CHARS, MAX_NAME_CHARS, MAX_TEXT_CHARS, ModeAxis } from "../../../contract";
import { command, FIVE_MODELS } from "./rig";

describe("the permissions axis", () => {
	test("offers the six modes of D12 in order, with a warning on bypass, and defaults to default", () => {
		const axis = permissionsAxis(FIVE_MODELS, true);
		expect(ModeAxis.safeParse(axis).success).toBe(true);
		expect(axis.id).toBe("permissions");
		expect(axis.options.map((option) => option.value)).toEqual([...PERMISSION_MODES]);
		expect(axis.defaultValue).toBe("default");
		const bypass = axis.options.find((option) => option.value === "bypassPermissions");
		expect(bypass?.description).toContain("Warning");
		for (const option of axis.options) expect(option.label).not.toBe("");
	});

	test("lists auto only where a model supports it", () => {
		const without: ModelInfo[] = FIVE_MODELS.map((model) => ({ ...model, supportsAutoMode: false }));
		expect(permissionsAxis(without, true).options.map((option) => option.value)).toEqual([
			"default",
			"acceptEdits",
			"plan",
			"dontAsk",
			"bypassPermissions",
		]);
		const one = without.map((model, at) => (at === 3 ? { ...model, supportsAutoMode: true } : model));
		expect(permissionsAxis(one, true).options.map((option) => option.value)).toContain("auto");
		expect(permissionsAxis([], true).options.map((option) => option.value)).not.toContain("auto");
	});

	test("leaves bypass out where the CLI would refuse to start with it (root outside a sandbox)", () => {
		const values = permissionsAxis(FIVE_MODELS, false).options.map((option) => option.value);
		expect(values).not.toContain("bypassPermissions");
		expect(values).toContain("default");
		expect(mayBypassPermissions(0, {})).toBe(false);
		expect(mayBypassPermissions(0, { IS_SANDBOX: "1" })).toBe(true);
		expect(mayBypassPermissions(0, { IS_SANDBOX: "yes" })).toBe(false);
		expect(mayBypassPermissions(0, { CLAUDE_CODE_BUBBLEWRAP: "1" })).toBe(true);
		expect(mayBypassPermissions(501, {})).toBe(true);
		expect(mayBypassPermissions(undefined, {})).toBe(true);
	});
});

describe("the command list", () => {
	test("lists commands a project defined before the CLI's own, each group in the CLI's order", () => {
		const listed = commandsOf([
			command("deep-research", true),
			command("compact", true),
			command("conformance"),
			command("review"),
			command("clear", true),
		]);
		expect(listed.map((entry) => entry.id)).toEqual(["conformance", "review", "deep-research", "compact", "clear"]);
		for (const entry of listed) expect(CommandSummary.safeParse(entry).success).toBe(true);
	});

	test("marks the names the CLI reloaded as skills and the rest as commands", () => {
		const listed = commandsOf(
			[command("demo"), command("conformance"), command("dataviz", true), command("compact", true)],
			new Set(["demo", "dataviz"]),
		);
		expect(listed.map((entry) => [entry.id, entry.kind])).toEqual([
			["demo", "skill"],
			["conformance", "command"],
			["dataviz", "skill"],
			["compact", "command"],
		]);
	});

	test("hides the built-ins the CLI binds to a terminal, but not a user command of the same name", () => {
		const listed = commandsOf([
			command("doctor", true),
			command("color", true),
			command("focus", true),
			command("reload-plugins", true),
			command("compact", true),
			command("doctor"),
		]);
		expect(listed.map((entry) => entry.id)).toEqual(["doctor", "compact"]);
		expect(listed.find((entry) => entry.id === "doctor")?.description).toBe("doctor description");
	});

	test("lists a name once, as the row `/name` runs: the marked one, else the first", () => {
		const listed = commandsOf([
			{ name: "init", description: "user", argumentHint: "" },
			{ name: "init", description: "builtin", argumentHint: "", builtin: true },
			{ name: "plain", description: "first", argumentHint: "" },
			{ name: "plain", description: "second", argumentHint: "" },
		]);
		expect(listed.map((entry) => [entry.id, entry.description])).toEqual([
			["plain", "first"],
			["init", "builtin"],
		]);
	});

	test("strips a leading slash, skips names that cannot be ids, and bounds long text", () => {
		const listed = commandsOf([
			command("/slashed"),
			command("has space"),
			command(""),
			command("x".repeat(MAX_ID_CHARS + 1)),
			{ name: "long", description: "d".repeat(MAX_TEXT_CHARS + 5), argumentHint: "h".repeat(MAX_NAME_CHARS + 5) },
		]);
		expect(listed.map((entry) => entry.id)).toEqual(["slashed", "long"]);
		const long = listed[1];
		expect(long?.description?.length).toBe(MAX_TEXT_CHARS);
		expect(long?.argumentHint?.length).toBe(MAX_NAME_CHARS);
	});

	test("carries the argument hint, and omits an empty description or hint", () => {
		const [bare, hinted] = commandsOf([
			{ name: "debug", description: "Debug", argumentHint: "[issue]", builtin: true },
			{ name: "bare", description: "", argumentHint: "" },
		]);
		expect(bare).toEqual({ id: "bare", name: "bare", kind: "command" });
		expect(hinted).toMatchObject({ id: "debug", argumentHint: "[issue]" });
	});
});
