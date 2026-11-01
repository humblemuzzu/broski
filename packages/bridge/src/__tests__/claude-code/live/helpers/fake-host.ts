/** Driving a host over a `FakeQuery`: what the host sent it, and letting its consumer loop catch up. */

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { QueryParams } from "../../../../backends/claude-code/ports";
import type { PromptInput } from "../../../../contract";

/** Lets the consumer loop and every promise it started run to rest. */
export async function flush(): Promise<void> {
	for (let turn = 0; turn < 4; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** The next `count` messages the host pushed into the query's prompt. */
export async function sent(call: QueryParams | undefined, count = 1): Promise<SDKUserMessage[]> {
	if (!call) throw new Error("no query was started");
	const iterator = call.prompt[Symbol.asyncIterator]();
	const out: SDKUserMessage[] = [];
	for (let index = 0; index < count; index++) {
		const next = await iterator.next();
		if (next.done) break;
		out.push(next.value);
	}
	return out;
}

export function promptOf(
	text: string,
	mode: PromptInput["mode"] = "start",
	clientRequestId = crypto.randomUUID(),
): PromptInput {
	return { clientRequestId, mode, text, attachments: [], mentions: [] };
}

/** A real, empty directory (the registry checks the cwd exists); `remove` deletes it. */
export function tempProject(): { dir: string; remove: () => void } {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "cc-live-")));
	return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
