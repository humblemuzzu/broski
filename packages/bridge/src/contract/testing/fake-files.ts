import type { BackendCallResult } from "../backend-ops";
import type { ConfigFileOp } from "../config-ops";
import type { CustomToolOp } from "../custom-tool-ops";
import type { EditableFile, EditableFileChange } from "../editable-file";
import { rejected } from "./fake-validation";

/** The revision of a file that is not there. */
const ABSENT = "absent";
/** The one configuration file the fake lists (`fakeConfigResult`), as it starts. */
const LISTED: Stored = { text: "{}\n", revision: "fake-0" };

interface Stored {
	readonly text: string;
	readonly revision: string;
}

/**
 * The fake's editable files (`config_file`, `custom_tool`), in memory: writes are compare-and-swap on the revision, a
 * write that does not parse as JSON is refused, and an id the fake never named is not found, as the contract asks of
 * every adapter. A file named but not there is held as `undefined`.
 */
export class FakeFiles {
	private readonly files = new Map<string, Stored | undefined>([["settings", LISTED]]);
	private written = 0;
	private newTools = 0;

	answer(op: ConfigFileOp | CustomToolOp): BackendCallResult {
		if (op.kind === "custom_tool" && op.change && op.toolId === undefined) {
			return rejected("invalid_input", "a change names the tool it changes");
		}
		const id = op.kind === "config_file" ? this.fileId(op) : this.toolId(op);
		if (!this.files.has(id)) return rejected("not_found", `no file ${id}`);
		if (op.change) {
			const problem = this.change(id, op.change);
			if (problem) return problem;
		}
		const file = this.file(id);
		return {
			status: "accepted",
			result: op.kind === "config_file" ? { kind: "config_file", file } : { kind: "custom_tool", file },
		};
	}

	/** A name makes a new file beside the listed one, named from then on. */
	private fileId(op: ConfigFileOp): string {
		if (op.name === undefined) return op.fileId;
		const id = `${op.fileId}/${op.name}`;
		if (!this.files.has(id)) this.files.set(id, undefined);
		return id;
	}

	private toolId(op: CustomToolOp): string {
		if (op.toolId !== undefined) return op.toolId;
		this.newTools += 1;
		const id = `new-tool-${this.newTools}`;
		this.files.set(id, undefined);
		return id;
	}

	private change(id: string, change: EditableFileChange): BackendCallResult | undefined {
		if (change.revision !== (this.files.get(id)?.revision ?? ABSENT)) {
			return rejected("stale", `${id} changed since revision ${change.revision}`);
		}
		if (change.kind === "delete") {
			this.files.set(id, undefined);
			return undefined;
		}
		try {
			JSON.parse(change.text);
		} catch (error) {
			return rejected("invalid_input", `${id} is not JSON: ${String(error)}`);
		}
		this.written += 1;
		this.files.set(id, { text: change.text, revision: `fake-${this.written}` });
		return undefined;
	}

	private file(id: string): EditableFile {
		const stored = this.files.get(id);
		return {
			id,
			path: `/fake/files/${id}.json`,
			scope: "project",
			format: "json",
			exists: stored !== undefined,
			text: stored?.text ?? "",
			revision: stored?.revision ?? ABSENT,
			editable: true,
			truncated: false,
			problems: [],
		};
	}
}
