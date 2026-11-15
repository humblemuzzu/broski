import { z } from "zod";
import { SessionRef } from "../../src/contract";
import { FAKE_SCENARIOS } from "./scenarios";

const id = z.int().nonnegative();

/** One line of the fake bridge's stdin; anything else is answered with an error. */
export const FakeCommand = z.discriminatedUnion("cmd", [
	z.strictObject({ id, cmd: z.literal("seed"), cwd: z.string().min(1), title: z.string().optional() }),
	z.strictObject({ id, cmd: z.literal("script"), session: SessionRef, scenario: z.enum(FAKE_SCENARIOS) }),
	z.strictObject({ id, cmd: z.literal("release"), session: SessionRef }),
	z.strictObject({ id, cmd: z.literal("restart") }),
]);
export type FakeCommand = z.infer<typeof FakeCommand>;

/** The command on `line`, or why there is none, with the id when one can be read. */
export function readCommand(line: string): { command: FakeCommand } | { id: number | null; error: string } {
	let json: unknown;
	try {
		json = JSON.parse(line);
	} catch (error) {
		return { id: null, error: `not JSON: ${String(error)}` };
	}
	const parsed = FakeCommand.safeParse(json);
	if (parsed.success) return { command: parsed.data };
	const read = z.object({ id }).safeParse(json);
	return { id: read.success ? read.data.id : null, error: z.prettifyError(parsed.error) };
}
