/** A person decides on an ask's text, so a terminal's ask and a hosted one show the same text, with no hidden reordering. */

import { describe, expect, test } from "bun:test";
import { phoneLine, phoneText } from "../../../backends/claude-code/phone-text";
import { permissionAsk } from "../../../backends/claude-code/terminal/hook-interaction";
import type { Interaction } from "../../../contract";
import { DeskRig } from "./desk-rig";

const TRICK = "echo safe \u202e# ;dm- fr\u2066x\u2069\u200f\u061c";
const HIDDEN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

function commandOf(interaction: Interaction): string | undefined {
	if (interaction.request.kind !== "tool_permission") return undefined;
	const preview = interaction.request.previews.find((candidate) => candidate.kind === "command");
	return preview?.kind === "command" ? preview.command : undefined;
}

function terminalAsk(): Interaction {
	return permissionAsk(
		{
			hook_event_name: "PermissionRequest",
			session_id: "5f0c2c55-6a3c-4a4e-9d0e-3c8d3c2b9a10",
			transcript_path: "/nowhere.jsonl",
			cwd: "/work\u202e",
			tool_name: "Bash",
			tool_input: { command: TRICK },
		},
		{ id: "i-1", runId: undefined, createdAt: 0, toolCallId: undefined },
	).interaction;
}

describe("the one sanitiser for what the phone shows", () => {
	test("a terminal ask's title and command carry no bidi or direction character", () => {
		const ask = terminalAsk();
		expect(ask.title).not.toMatch(HIDDEN);
		expect(ask.title).toBe("Bash: echo safe # ;dm- frx");
		expect(commandOf(ask)).toBe("echo safe # ;dm- frx");
	});

	test("a hosted ask for the same call shows the same title and command", () => {
		const rig = new DeskRig();
		rig.tool("Bash", { command: TRICK }, {});
		const hosted = rig.only();
		const terminal = terminalAsk();
		expect(hosted.title).toBe(terminal.title);
		expect(commandOf(hosted)).toBe(commandOf(terminal));
	});

	test("escapes and C0/C1 controls go, newlines and tabs stay; a line is folded to one", () => {
		expect(phoneText("a\u001b[31mred\u001b[0m\u0007\u009b2Jb\n\tc\u0085")).toBe("aredb\n\tc");
		expect(phoneLine("  two\nlines\u202e ")).toBe("two lines");
	});
});
