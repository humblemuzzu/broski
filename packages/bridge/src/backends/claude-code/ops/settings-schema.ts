/**
 * Whether Claude Code would load a settings text or skip the whole file for failing its schema (research 05 fact 1).
 * The SDK's own reader decides: the text goes into a scratch project's local settings and `resolveSettings` says
 * whether anything of it was loaded. A file the schema rejects loads nothing, not even its valid keys.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseObject } from "../files/json-object";
import type { ClaudeSdk } from "../ports";

const SKIPPED = "its content does not satisfy Claude Code's settings schema, so Claude Code would skip the whole file";

/** Why Claude Code skips `text` as a settings file, or undefined when it loads (an empty object has nothing to load). */
export async function schemaProblem(sdk: ClaudeSdk, text: string): Promise<string | undefined> {
	const parsed = parseObject(text);
	if ("problem" in parsed) return parsed.problem;
	if (Object.keys(parsed.value).length === 0) return undefined;
	const scratch = await mkdtemp(join(tmpdir(), "broski-settings-check-"));
	try {
		await mkdir(join(scratch, ".claude"));
		await writeFile(join(scratch, ".claude", "settings.local.json"), text);
		const resolved = await sdk.resolveSettings({ cwd: scratch, settingSources: ["local"] });
		return resolved.sources.some((source) => source.source === "local") ? undefined : SKIPPED;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

export const SCHEMA_SKIP_PROBLEM = SKIPPED;
