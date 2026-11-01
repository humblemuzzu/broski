/** `rewind_files` (D23): restore the files edited since a user message, on the session's host or a transient one. */

import type { RewindFilesResult } from "@anthropic-ai/claude-agent-sdk";
import { type BackendCallResult, MAX_PATH_CHARS, MAX_TEXT_CHARS, type RewindFilesOp } from "../../../contract";
import { boundList, clip } from "../bounds";
import type { OpsDeps } from "../ports";
import { isRejected, rejected } from "../rejections";
import { guarded } from "./guard";

function count(value: number | undefined): number | undefined {
	return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function resultOf(rewound: RewindFilesResult) {
	const files = rewound.filesChanged === undefined ? undefined : boundList(rewound.filesChanged).items;
	const insertions = count(rewound.insertions);
	const deletions = count(rewound.deletions);
	const skipped = count(rewound.skippedLinks);
	return {
		kind: "rewind_files" as const,
		canRewind: rewound.canRewind,
		...(files && { filesChanged: files.map((path) => clip(path, MAX_PATH_CHARS)) }),
		...(insertions !== undefined && { insertions }),
		...(deletions !== undefined && { deletions }),
		...(skipped !== undefined && { skippedLinks: skipped }),
		...(rewound.error !== undefined && { error: clip(rewound.error, MAX_TEXT_CHARS) }),
	};
}

export async function rewindFiles(deps: OpsDeps, op: RewindFilesOp): Promise<BackendCallResult> {
	return guarded("rewind_files", async () => {
		const stored = await deps.store.locate(op.sessionId);
		if (isRejected(stored)) return stored;
		const entry = await deps.store.entryOf(op.sessionId, op.userItemId);
		if (isRejected(entry)) return entry;
		if (entry.type !== "user")
			return rejected("invalid_input", "files are restored to a point just before a message you sent");
		const result = await deps.live.withHost(op.sessionId, async (host) => {
			if (!op.dryRun && host.busy()) return rejected("busy", "the session is working: stop it before restoring files");
			return resultOf(await host.query.rewindFiles(entry.uuid, { dryRun: op.dryRun }));
		});
		return result;
	});
}
