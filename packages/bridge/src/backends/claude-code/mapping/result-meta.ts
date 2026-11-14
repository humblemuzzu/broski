/**
 * The live `user` frame's `tool_result_meta`, which the SDK does not declare (D18): the 2.1.325 binary's schema is
 * `[{id, non_execution_kind?, permission_decision?: {decision: "accept" | "reject" | "cancelled", source}}]`
 * ("@internal Display metadata", recorded in `fixtures/frames/permission-deny.jsonl`). A transcript has no such
 * field, so history keeps reading a refusal from its wording (`tool-outcome.ts`).
 */

import { z } from "zod";

const ResultMeta = z.array(
	z.looseObject({
		id: z.string(),
		permission_decision: z.looseObject({ decision: z.string() }).optional().catch(undefined),
	}),
);

/** The tool use ids whose permission was refused; none when the frame carries no readable metadata. */
export function refusedToolUseIds(frame: object): ReadonlySet<string> {
	if (!("tool_result_meta" in frame)) return new Set();
	const parsed = ResultMeta.safeParse(frame.tool_result_meta);
	if (!parsed.success) return new Set();
	return new Set(parsed.data.flatMap((meta) => (meta.permission_decision?.decision === "reject" ? [meta.id] : [])));
}
