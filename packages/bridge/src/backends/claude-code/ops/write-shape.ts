/** What a text must be before it may replace a config file: a file Claude Code would skip is never written. */

import { isRecord } from "../json";
import type { OpsDeps } from "../ports";
import type { ConfigPlace } from "./config-paths";
import { parseObject } from "./json-check";
import { schemaProblem } from "./settings-schema";

/** Why `text` may not be written to `place`, or undefined. */
export async function shapeProblem(deps: OpsDeps, place: ConfigPlace, text: string): Promise<string | undefined> {
	if (place.format !== "json") return undefined;
	const parsed = parseObject(text);
	if ("problem" in parsed) return `not valid JSON, so it was not written: ${parsed.problem}`;
	if (place.kind === "mcp") {
		const servers = parsed.value.mcpServers;
		return servers !== undefined && !isRecord(servers) ? "mcpServers must be an object" : undefined;
	}
	if (place.kind !== "settings") return undefined;
	const skipped = await schemaProblem(deps.services.sdk, text);
	return skipped === undefined ? undefined : `${skipped}, so it was not written`;
}
