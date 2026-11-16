/** A new session: its file written as the `pi` command would write it, then hosted with the model chosen for it. */

import { readFile, unlink } from "node:fs/promises";
import type { NewSessionOptions, OpenResult, Rejected, SessionSink } from "../../../contract";
import { errorText } from "../error-text";
import type { ModelCatalogue } from "../models/catalogue";
import { initialPermissions } from "../modes";
import type { SessionStore } from "../ports";
import { rejected } from "../rejections";
import type { HostStart } from "./host-environment";
import type { Target } from "./host-starts";
import { createSessionFile } from "./new-session-file";
import { chooseModel } from "./new-session-options";
import type { SessionHost } from "./session-host";
import type { SessionLocks } from "./session-lock";

export interface NewSessionRegistry {
	readonly models: Pick<ModelCatalogue, "find" | "missing" | "starting">;
	readonly store: SessionStore;
	readonly locks: SessionLocks;
	readonly now: () => number;
	start(
		target: Target,
		permissions: HostStart["permissions"],
		facts: HostStart["facts"],
	): Promise<SessionHost | Rejected>;
	/** The view of the started host, which is announced in the list. */
	attach(host: SessionHost, sink: SessionSink): OpenResult;
}

export async function openNewSession(
	registry: NewSessionRegistry,
	options: NewSessionOptions,
	sink: SessionSink,
): Promise<OpenResult> {
	const choice = await chooseModel(options, registry.models);
	if ("status" in choice) return choice;
	const permissions = initialPermissions(options.modes);
	const now = registry.now();
	let created: Awaited<ReturnType<typeof createSessionFile>>;
	try {
		const directory = registry.store.sessionDirFor(options.cwd);
		created = await createSessionFile({ cwd: options.cwd, directory, permissions, now });
	} catch (error) {
		return rejected("backend_error", `the session could not be created: ${errorText(error)}`);
	}
	const facts = {
		sessionId: created.sessionId,
		cwd: options.cwd,
		createdAt: now,
		updatedAt: now,
		origin: "broski" as const,
		prompted: false,
	};
	const target: Target = {
		sessionId: created.sessionId,
		cwd: options.cwd,
		file: created.path,
		lastEntryId: created.lastEntryId,
	};
	return registry.locks.run(created.sessionId, async () => {
		const host = await registry.start(target, { mode: permissions, allowedTools: [] }, facts);
		if ("status" in host) {
			await discardUnused(created.path);
			return host;
		}
		const applied = await host.applyChoice({ modelId: options.modelId, thinking: choice.thinking });
		if (applied.status === "rejected") {
			await host.finish();
			await discardUnused(created.path);
			return applied;
		}
		return registry.attach(host, sink);
	});
}

/** A new session whose host did not start, and that holds no conversation, is left as Pi leaves such a session: with no file. */
async function discardUnused(path: string): Promise<void> {
	const text = await readFile(path, "utf8").catch(() => undefined);
	if (text === undefined || text.split("\n").some((line) => line.startsWith('{"type":"message"'))) return;
	await unlink(path).catch(() => undefined);
}
