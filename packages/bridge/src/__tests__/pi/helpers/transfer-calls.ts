/** Session files moving through the Pi backend's ops, the way the phone does it: an export read part by part, an upload sent part by part. */

import {
	type AgentBackend,
	type BackendCall,
	type BackendCallResult,
	type BackendOpKind,
	type BackendOpResult,
	MAX_TRANSFER_PART_BYTES,
	type PiOp,
	type SessionExportFormat,
	type SessionRef,
} from "../../../contract";

export interface Exported {
	readonly exportId: string;
	readonly name: string;
	readonly mimeType: string;
	readonly bytes: Buffer;
	readonly parts: number;
}

export async function callPi(backend: AgentBackend, call: PiOp): Promise<BackendCallResult> {
	if (backend.call === undefined) throw new Error("the backend has no call()");
	return backend.call({ backend: "pi", op: call });
}

export function accepted<K extends BackendOpResult["kind"]>(
	result: BackendCallResult,
	kind: K,
): Extract<BackendOpResult, { kind: K }> {
	if (result.status === "rejected") throw new Error(`rejected ${result.rejection.code}: ${result.rejection.message}`);
	const found = result.result;
	if (!isKind(found, kind)) throw new Error(`expected ${kind}, got ${found.kind}`);
	return found;
}

function isKind<K extends BackendOpResult["kind"]>(
	result: BackendOpResult,
	kind: K,
): result is Extract<BackendOpResult, { kind: K }> {
	return result.kind === kind;
}

/** Exports a session and reads every part of it, in order. */
export async function readExport(
	backend: AgentBackend,
	sessionId: string,
	format: SessionExportFormat,
): Promise<Exported> {
	const made = accepted(await callPi(backend, { kind: "export_session", sessionId, format }), "export_session");
	const chunks: Buffer[] = [];
	let offset = 0;
	for (;;) {
		const part = accepted(
			await callPi(backend, { kind: "export_part", sessionId, exportId: made.exportId, offset }),
			"export_part",
		);
		const bytes = Buffer.from(part.data, "base64");
		chunks.push(bytes);
		offset += bytes.length;
		if (part.done) break;
	}
	const bytes = Buffer.concat(chunks);
	if (bytes.length !== made.bytes) throw new Error(`read ${bytes.length} bytes of ${made.bytes}`);
	return { exportId: made.exportId, name: made.name, mimeType: made.mimeType, bytes, parts: chunks.length };
}

/** Sends `bytes` as one upload in parts of `partBytes`, the last one committing it. */
export async function uploadSession(
	backend: AgentBackend,
	uploadId: string,
	bytes: Buffer,
	partBytes = MAX_TRANSFER_PART_BYTES,
): Promise<BackendCallResult> {
	let offset = 0;
	let result: BackendCallResult | undefined;
	do {
		const end = Math.min(bytes.length, offset + partBytes);
		const last = end >= bytes.length;
		result = await callPi(backend, {
			kind: "import_session",
			uploadId,
			offset,
			data: bytes.subarray(offset, end).toString("base64"),
			last,
		});
		if (result.status === "rejected" || last) return result;
		offset = end;
	} while (offset < bytes.length);
	return result;
}

/** The session file of `bytes` under another session id, as a copy another machine would hold. */
export function withSessionId(bytes: Buffer, sessionId: string): Buffer {
	const text = bytes.toString("utf8");
	const newline = text.indexOf("\n");
	const header: Record<string, unknown> = JSON.parse(text.slice(0, newline));
	return Buffer.from(`${JSON.stringify({ ...header, id: sessionId })}${text.slice(newline)}`);
}

/** A valid call of the file-moving, reading and refreshing ops the conformance rule builds; undefined for any other op. */
export async function transferCall(
	backend: AgentBackend,
	session: SessionRef,
	op: BackendOpKind,
): Promise<BackendCall | undefined> {
	const { sessionId } = session;
	switch (op) {
		case "export_session":
			return { backend: "pi", op: { kind: op, sessionId, format: "jsonl" } };
		case "export_part": {
			const made = accepted(
				await callPi(backend, { kind: "export_session", sessionId, format: "jsonl" }),
				"export_session",
			);
			return { backend: "pi", op: { kind: op, sessionId, exportId: made.exportId, offset: 0 } };
		}
		case "import_session": {
			const copy = withSessionId((await readExport(backend, sessionId, "jsonl")).bytes, crypto.randomUUID());
			return {
				backend: "pi",
				op: { kind: op, uploadId: crypto.randomUUID(), offset: 0, data: copy.toString("base64"), last: true },
			};
		}
		case "changed_files":
			return { backend: "pi", op: { kind: op, sessionId } };
		case "refresh_models":
			return { backend: "pi", op: { kind: op } };
		default:
			return undefined;
	}
}
