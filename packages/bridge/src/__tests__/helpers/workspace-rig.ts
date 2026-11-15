/**
 * The core with the bridge's real workspace behind it (the production path policy, git, the native PTY), for
 * tests that drive files, git and terminals over the contract. The policy allows the home and the temp
 * directory under test (`setup/test-isolation.ts`).
 */

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rejected, RejectionCode, ServerMessage, TermOutputMessage } from "../../contract";
import type { CoreOptions } from "../../core/core";
import { allowedBasePaths, resolveSecurePath } from "../../security";
import { workspaceFactory } from "../../workspace/workspace-host";
import { type CoreRig, startCoreRig, type TestClient } from "./core-rig";

export function realWorkspace(): Pick<CoreOptions, "workspace"> {
	return { workspace: workspaceFactory({ policy: resolveSecurePath, bases: allowedBasePaths() }) };
}

export function startWorkspaceRig(core: Partial<CoreOptions> = {}): Promise<CoreRig> {
	return startCoreRig({ core: { ...realWorkspace(), ...core } });
}

/** A new directory in the temp directory, canonical, as the path policy answers it. */
export function tempDirectory(prefix: string): string {
	return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** Waits on real time for something another process causes, polling every few milliseconds. */
export async function eventually<T>(read: () => T | undefined, label: string, timeoutMs = 10_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = read();
		if (value !== undefined && value !== false) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
		await Bun.sleep(5);
	}
}

/** The result a workspace response carries, which must be accepted. */
export function accepted<R extends { status: "accepted" }>(result: R | Rejected): R {
	if (result.status === "rejected") throw new Error(`rejected: ${JSON.stringify(result.rejection)}`);
	return result;
}

/** The code a workspace response's result was rejected with, or undefined when it was accepted. */
export function rejectionCode(result: { status: string } | Rejected): RejectionCode | undefined {
	return "rejection" in result ? result.rejection.code : undefined;
}

export function base64(text: string | Uint8Array): string {
	return Buffer.from(text).toString("base64");
}

export function termOutputs(messages: readonly ServerMessage[], id: string): TermOutputMessage[] {
	return messages.flatMap((message) => (message.type === "term_output" && message.id === id ? [message] : []));
}

/** The bytes a client received from a terminal, in order, checked to follow each other without a gap. */
export function receivedBytes(client: TestClient, id: string, from = 0): Buffer {
	let next = from;
	const parts = termOutputs(client.messages, id).map((output) => {
		if (output.seq !== next) throw new Error(`output at ${output.seq} after ${next}: a gap or a repeat`);
		const bytes = Buffer.from(output.data, "base64");
		next += bytes.length;
		return bytes;
	});
	return Buffer.concat(parts);
}
