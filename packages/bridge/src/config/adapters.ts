/**
 * The config's `adapters`, the third-party adapters `server/plugin-loader.ts` loads. Each entry is checked alone: one
 * the schema refuses, or one past the first `MAX_ADAPTERS`, is left out with why, and the rest of the config stands.
 */

import { z } from "zod";
import { BackendId } from "../contract/ids";

export const MAX_ADAPTERS = 16;

/** `module` is an absolute path, or the name of a package installed in `~/.broski/adapters`. */
const AdapterEntry = z.object({
	id: BackendId,
	module: z.string().min(1).max(512),
	enabled: z.boolean().default(true),
	/** Handed to the plugin as `ctx.config`. */
	config: z.record(z.string(), z.unknown()).optional(),
});
export type AdapterEntry = z.infer<typeof AdapterEntry>;

export interface CheckedAdapters {
	readonly entries: AdapterEntry[];
	/** Why each entry left out was left out. */
	readonly problems: string[];
}

export function checkedAdapters(value: unknown): CheckedAdapters {
	if (value === undefined) return { entries: [], problems: [] };
	if (!Array.isArray(value)) return { entries: [], problems: ["adapters is not a list"] };
	const entries: AdapterEntry[] = [];
	const problems: string[] = [];
	for (const [index, raw] of value.entries()) {
		const parsed = AdapterEntry.safeParse(raw);
		if (!parsed.success) {
			const why = parsed.error.issues.map((issue) => `${issue.path.join(".") || "entry"}: ${issue.message}`);
			problems.push(`adapters[${index}]: ${why.join("; ")}`);
		} else if (entries.length >= MAX_ADAPTERS) {
			problems.push(`adapters[${index}]: more than ${MAX_ADAPTERS} adapters`);
		} else {
			entries.push(parsed.data);
		}
	}
	return { entries, problems };
}

export const Adapters = z
	.unknown()
	.transform((value) => checkedAdapters(value).entries)
	.default([]);
