import { BackendCall, type BackendCallResult, type BackendOpKind } from "../backend-ops";
import type { EditableFile, EditableFileChange } from "../editable-file";
import { expect, fail, type Rig } from "./conformance-harness";

type FileOpKind = Extract<BackendOpKind, "config_file" | "custom_tool">;

const OTHER_REVISION = "conformance-another-revision";
const NO_SUCH_FILE = "conformance-no-such-file";

/**
 * Every declared op that reads an editable file writes it only at the revision read: another revision is `stale`, a
 * JSON file only when the text parses (`invalid_input`), and a file the backend may not change never (`unsupported`).
 * Writing back what was read, at its revision, through the id the answer named, lands and answers the same text. An id
 * the backend never named is `not_found`.
 */
export async function editableFilesKeepTheirRevision(rig: Rig): Promise<void> {
	const { backend } = rig;
	if (!backend.call) return;
	const call = backend.call.bind(backend);
	for (const op of rig.traits.backendOps.filter(isFileOp)) {
		const live = await rig.openNew();
		await rig.arrange(live.ref, { kind: "reply" });
		await live.run("Leave some history.");
		const read = await rig.driver.backendCall(live.ref, op);
		if (!read) fail(`the driver cannot build a ${op} call`);
		const file = fileOf(op, await call(read));
		const nowhere = await call(addressing(read, NO_SUCH_FILE));
		expect(rejectedAs(nowhere, "not_found"), `${op} of a file the backend never named must be not_found`);
		const write = async (change: EditableFileChange) => call(addressing(read, file.id, change));
		if (!file.editable) {
			const refused = await write({ kind: "write", text: file.text, revision: file.revision });
			expect(rejectedAs(refused, "unsupported"), `a write to a file ${op} cannot change must be unsupported`);
			continue;
		}
		const stale = await write({ kind: "write", text: file.text, revision: OTHER_REVISION });
		expect(rejectedAs(stale, "stale"), `a ${op} write at another revision must be stale`);
		if (file.format === "json") {
			const broken = await write({ kind: "write", text: "{", revision: file.revision });
			expect(rejectedAs(broken, "invalid_input"), `a ${op} write that is not JSON must be invalid_input`);
		}
		if (!file.exists) continue;
		const kept = fileOf(op, await write({ kind: "write", text: file.text, revision: file.revision }));
		expect(kept.text === file.text, `${op} answered other text than it wrote`);
	}
}

function isFileOp(op: BackendOpKind): op is FileOpKind {
	return op === "config_file" || op === "custom_tool";
}

function fileOf(op: FileOpKind, result: BackendCallResult): EditableFile {
	if (result.status === "rejected") fail(`${op} was rejected: ${result.rejection.message}`);
	if (result.result.kind !== op) fail(`${op} answered with a ${result.result.kind} result`);
	if (result.result.kind !== "config_file" && result.result.kind !== "custom_tool") fail(`${op} answered no file`);
	return result.result.file;
}

function rejectedAs(result: BackendCallResult, code: string): boolean {
	return result.status === "rejected" && result.rejection.code === code;
}

/** `read` addressing the file `id`, the id an answer named, with `change` when there is one. */
function addressing(read: BackendCall, id: string, change?: EditableFileChange): BackendCall {
	const { op } = read;
	if (op.kind === "config_file") {
		const { name: _name, change: _change, ...rest } = op;
		return BackendCall.parse({ ...read, op: { ...rest, fileId: id, ...(change && { change }) } });
	}
	if (op.kind === "custom_tool") {
		const { change: _change, ...rest } = op;
		return BackendCall.parse({ ...read, op: { ...rest, toolId: id, ...(change && { change }) } });
	}
	return fail(`${op.kind} reads no file`);
}
