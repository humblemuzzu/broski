import type { BackendCallResult } from "../backend-ops";
import type { ConfigFileOp } from "../config-ops";
import type { CustomToolOp } from "../custom-tool-ops";
import type { EditableFile, EditableFileChange } from "../editable-file";
import { rejected } from "./fake-validation";

/** The revision of a file that is not there. */
const ABSENT = "absent";
/** Every file the fake is asked for starts as this JSON, until it is written or deleted. */
const STARTING_TEXT = "{}\n";

interface Stored {
	readonly text: string;
	readonly revision: string;
}

/**
 * The fake's editable files (`config_file`, `custom_tool`), in memory: writes are compare-and-swap on the revision and
 * a write that does not parse as JSON is refused, as the contract asks of every adapter.
 */
export class FakeFiles {
	private readonly files = new Map<string, Stored | undefined>();
	private written = 0;
	private newTools = 0;

	answer(op: ConfigFileOp | CustomToolOp): BackendCallResult {
		if (op.kind === "custom_tool" && op.change && op.toolId === undefined) {
			return rejected("invalid_input", "a change names the tool it changes");
		}
		const id = op.kind === "config_file" ? (op.name ? `${op.fileId}/${op.name}` : op.fileId) : this.toolId(op);
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

	private toolId(op: CustomToolOp): string {
		if (op.toolId !== undefined) return op.toolId;
		this.newTools += 1;
		const id = `new-tool-${this.newTools}`;
		this.files.set(id, undefined);
		return id;
	}

	private change(id: string, change: EditableFileChange): BackendCallResult | undefined {
		if (change.revision !== (this.stored(id)?.revision ?? ABSENT)) {
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

	private stored(id: string): Stored | undefined {
		if (!this.files.has(id)) this.files.set(id, { text: STARTING_TEXT, revision: "fake-0" });
		return this.files.get(id);
	}

	private file(id: string): EditableFile {
		const stored = this.stored(id);
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
