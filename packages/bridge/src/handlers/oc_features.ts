import { findOpenCodeDbPath, listProjectsFromDb as ocListProjectsFromDb } from "../connectors/opencode/oc-sqlite";
import { mapOpenCodeStatusToRuntimeState } from "../runtime/opencode-runtime-read-models";
import type { ClientMessage, ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

type OpenCodeFeaturesLike = {
	listProjects: () => Promise<any[]>;
	getTodos: (id: string, dir?: string) => Promise<any[]>;
	listCommands: (dir?: string) => Promise<any[]>;
	executeCommand: (
		id: string,
		cmd: string,
		args: any,
		dir?: string,
		agent?: string,
		model?: any,
		variant?: string,
		parts?: any,
	) => Promise<any>;
	listAgents: (dir?: string) => Promise<any[]>;
	getVcsInfo: (dir?: string) => Promise<any>;
	getVcsDiff: (mode: "git" | "branch", dir?: string) => Promise<any[]>;
	getLspStatus: (dir?: string) => Promise<any[]>;
	getFormatterStatus: (dir?: string) => Promise<any[]>;
	listToolIds: (dir?: string) => Promise<string[]>;
	listTools: (provider: string, model: string, dir?: string) => Promise<any[]>;
	getSessionStatus: (dir?: string) => Promise<Record<string, any>>;
	disposeInstance: (dir?: string) => Promise<boolean>;
	getCurrentProject: (dir?: string) => Promise<any>;
	updateProject: (id: string, updates: any, dir?: string) => Promise<any>;
	listPendingPermissions: (dir?: string) => Promise<any[]>;
	listPendingQuestions: (dir?: string) => Promise<any[]>;
	listSdkSkills: (dir?: string) => Promise<any[]>;
};

export async function handle(
	message: ClientMessage & { requestId?: string },
	reply: Reply,
	requireOpenCode: () => OpenCodeFeaturesLike,
): Promise<boolean> {
	switch (message.type) {
		case "list_projects": {
			let projects: any[];
			try {
				const oc = requireOpenCode();
				projects = await oc.listProjects();
			} catch {
				// OpenCode server unavailable — fall back to direct SQLite read.
				try {
					const dbPath = findOpenCodeDbPath();
					projects = dbPath ? ocListProjectsFromDb(dbPath) : [];
				} catch {
					// SQLite also failed (corrupt DB, missing table, etc.) — give up gracefully.
					projects = [];
				}
			}
			reply({ type: "projects", data: projects });
			return true;
		}
		case "get_todos": {
			const oc = requireOpenCode();
			const todos = await oc.getTodos(message.sessionId, message.projectPath);
			reply({ type: "todos", data: todos, sessionId: message.sessionId });
			return true;
		}
		case "list_commands": {
			const oc = requireOpenCode();
			const commands = await oc.listCommands(message.projectPath);
			reply({ type: "commands", data: commands });
			return true;
		}
		case "execute_command": {
			const oc = requireOpenCode();
			const result = await oc.executeCommand(
				message.sessionId,
				message.command,
				message.arguments,
				message.projectPath,
				message.agent,
				message.model,
				message.variant,
				message.parts,
			);
			reply({ type: "command_executed", data: result, sessionId: message.sessionId });
			return true;
		}
		case "list_agents": {
			const oc = requireOpenCode();
			const agents = await oc.listAgents(message.projectPath);
			reply({ type: "agents", data: agents });
			return true;
		}
		case "get_vcs": {
			const oc = requireOpenCode();
			const vcs = await oc.getVcsInfo(message.projectPath);
			reply({ type: "vcs", data: vcs });
			return true;
		}
		case "get_vcs_diff": {
			const oc = requireOpenCode();
			const diffs = await oc.getVcsDiff(message.mode, message.projectPath);
			reply({ type: "vcs_diff", data: diffs, requestId: message.requestId });
			return true;
		}
		case "get_lsp_status": {
			const oc = requireOpenCode();
			const lspStatus = await oc.getLspStatus(message.projectPath);
			reply({ type: "lsp_status", data: lspStatus });
			return true;
		}
		case "get_formatter_status": {
			const oc = requireOpenCode();
			const formatterStatus = await oc.getFormatterStatus(message.projectPath);
			reply({ type: "formatter_status", data: formatterStatus });
			return true;
		}
		case "list_tool_ids": {
			const oc = requireOpenCode();
			const toolIds = await oc.listToolIds(message.projectPath);
			reply({ type: "tool_ids", data: toolIds });
			return true;
		}
		case "list_tools": {
			const oc = requireOpenCode();
			const tools = await oc.listTools(message.provider, message.model, message.projectPath);
			reply({ type: "tools", data: tools });
			return true;
		}
		case "get_session_status": {
			const oc = requireOpenCode();
			const status = await oc.getSessionStatus(message.projectPath);
			reply({ type: "session_status", data: status });
			for (const [sessionId, sessionStatus] of Object.entries(status)) {
				reply({
					type: "runtime_state",
					backend: "opencode",
					data: mapOpenCodeStatusToRuntimeState(sessionId, sessionStatus, message.projectPath),
				});
			}
			return true;
		}
		case "dispose_instance": {
			const oc = requireOpenCode();
			const disposed = await oc.disposeInstance(message.projectPath);
			reply({ type: "instance_disposed", data: disposed });
			return true;
		}
		case "get_current_project": {
			const oc = requireOpenCode();
			const project = await oc.getCurrentProject(message.projectPath);
			reply({ type: "current_project", data: project });
			return true;
		}
		case "update_project": {
			const oc = requireOpenCode();
			const project = await oc.updateProject(
				message.projectId,
				{ name: message.name, icon: message.icon },
				message.projectPath,
			);
			reply({ type: "project_updated", data: project });
			return true;
		}
		case "list_pending_permissions": {
			const oc = requireOpenCode();
			const pending = await oc.listPendingPermissions(message.projectPath);
			reply({ type: "pending_permissions", data: pending });
			return true;
		}
		case "list_pending_questions": {
			const oc = requireOpenCode();
			const pending = await oc.listPendingQuestions(message.projectPath);
			reply({ type: "pending_questions", data: pending });
			return true;
		}
		case "oc_list_sdk_skills": {
			const oc = requireOpenCode();
			const skills = await oc.listSdkSkills(message.projectPath);
			reply({ type: "oc_sdk_skills", data: skills });
			return true;
		}
		default:
			return false;
	}
}
