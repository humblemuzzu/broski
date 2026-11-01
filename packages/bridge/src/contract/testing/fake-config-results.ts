import type { ActionList } from "../action-list";
import type { BackendOp, BackendOpResult } from "../backend-ops";
import type { EditableFile } from "../editable-file";

/** The ops of a project's configuration, a session's lists and the bridge's own tools (1.4), as the fake answers them. */
export type FakeConfigOp = Extract<
	BackendOp,
	{
		kind:
			| "config_files"
			| "config_file"
			| "settings_overview"
			| "mcp_servers"
			| "plugins"
			| "tasks"
			| "context_usage"
			| "custom_tools"
			| "custom_tool";
	}
>;

export function fakeConfigResult(op: FakeConfigOp): BackendOpResult {
	switch (op.kind) {
		case "config_files":
			return {
				kind: op.kind,
				files: [
					{
						id: "settings",
						label: "Project settings",
						group: "settings",
						scope: "project",
						path: `${op.cwd}/.fake/settings.json`,
						exists: true,
						editable: true,
						format: "json",
						template: false,
					},
				],
				omitted: 0,
			};
		case "config_file":
			return { kind: op.kind, file: fakeFile(op.fileId, `${op.cwd}/.fake/settings.json`) };
		case "custom_tool":
			return { kind: op.kind, file: fakeFile(op.toolId ?? "new-tool", "custom-tools.json") };
		case "settings_overview":
		case "mcp_servers":
		case "plugins":
		case "tasks":
		case "context_usage":
		case "custom_tools":
			return { kind: op.kind, list: fakeList(op.kind) };
	}
}

function fakeFile(id: string, path: string): EditableFile {
	return {
		id,
		path,
		scope: "project",
		format: "json",
		exists: true,
		text: "{}\n",
		revision: "fake-1",
		editable: true,
		truncated: false,
		problems: [],
	};
}

function fakeList(kind: string): ActionList {
	return {
		rows: [
			{
				id: `${kind}-1`,
				title: `Fake ${kind}`,
				status: { label: "on", tone: "ok" },
				badges: [],
				actions: [{ id: "toggle", label: "Toggle", destructive: false }],
			},
		],
		omitted: 0,
	};
}
