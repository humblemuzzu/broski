/**
 * Every test here runs the real `agy` only on the developer's own Gemini API key in a profile of its own
 * (`profile.ts`), never on a Google sign-in, whose plan allows no program to drive agy (antigravity README, "Google's
 * rules"). Each kind is opt-in: `BROSKI_TEST_AGY=1` (live suite, conformance), `BROSKI_TEST_AGY_TERMINAL=1` too for the
 * terminal clash, `BROSKI_AGY_RECORD=1` for the recorder; none runs without `GEMINI_API_KEY`.
 */

export interface Gate {
	readonly runs: boolean;
	readonly why: string;
}

export const NO_API_KEY =
	"GEMINI_API_KEY is not set: agy runs here only on a Gemini API key, never on a Google sign-in";

export function gateOf(flag: string, env: Readonly<Record<string, string | undefined>>): Gate {
	if (env[flag] !== "1") return { runs: false, why: `opt-in: ${flag}=1 with GEMINI_API_KEY set` };
	if (!env.GEMINI_API_KEY?.trim()) return { runs: false, why: NO_API_KEY };
	return { runs: true, why: "" };
}

export const LIVE = gateOf("BROSKI_TEST_AGY", process.env);
export const TERMINAL = LIVE.runs ? gateOf("BROSKI_TEST_AGY_TERMINAL", process.env) : LIVE;
export const RECORD = gateOf("BROSKI_AGY_RECORD", process.env);

export function gated(title: string, gate: Gate): string {
	return gate.runs ? title : `${title} (skipped: ${gate.why})`;
}

/** The Gemini API once took 56 s for "Reply with exactly: ok", and a turn after `session/load` is two model steps. */
export const TURN_MS = 300_000;
const BESIDES_TURNS_MS = 120_000;
/** Each backend's stop ladder, with room to spare (`live-test.ts`). */
export const ENDING_MS = 30_000;

export function testMs(turns: number): number {
	return turns * TURN_MS + BESIDES_TURNS_MS;
}
