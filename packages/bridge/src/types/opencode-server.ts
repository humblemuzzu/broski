import type { Agent, Command, Todo } from "./common";
import type { SessionSummary } from "./session";

export type OcServerMessage =
	// Feature 1: Todo/Plan Management
	| { type: "todos"; data: Todo[]; sessionId: string; requestId?: string }
	// Feature 2: Slash Commands
	| { type: "commands"; data: Command[]; requestId?: string }
	| {
			type: "command_executed";
			data: unknown;
			sessionId: string;
			requestId?: string;
	  }
	// Feature 3: Agent Switching
	| { type: "agents"; data: Agent[]; requestId?: string }
	| { type: "oc_question_replied"; data: boolean; requestId?: string }
	| { type: "oc_question_rejected"; data: boolean; requestId?: string }
	// Skills (filesystem-backed)
	| {
			type: "oc_skills";
			data: Array<{
				name: string;
				description?: string;
				path: string;
				source: "project" | "user" | "system" | "admin" | "plugin";
				editable: boolean;
			}>;
			requestId?: string;
	  }
	| {
			type: "oc_skill";
			data: {
				name: string;
				path: string;
				source: "project" | "user";
				content: string;
			};
			requestId?: string;
	  }
	| {
			type: "oc_skill_saved";
			data: { ok: boolean; path?: string };
			requestId?: string;
	  }
	| { type: "oc_skill_deleted"; data: { ok: boolean }; requestId?: string }
	| {
			type: "oc_plugin_files";
			data: Array<{ name: string; path: string; source: "project" | "user" }>;
			requestId?: string;
	  }
	| {
			type: "oc_plugin_file";
			data: {
				name: string;
				path: string;
				source: "project" | "user";
				content: string;
			};
			requestId?: string;
	  }
	| {
			type: "oc_plugin_file_saved";
			data: { ok: boolean; path?: string };
			requestId?: string;
	  }
	| {
			type: "oc_plugin_file_deleted";
			data: { ok: boolean };
			requestId?: string;
	  }
	| {
			type: "oc_command_files";
			data: Array<{
				name: string;
				path: string;
				source: "project" | "user";
				description?: string;
			}>;
			requestId?: string;
	  }
	| {
			type: "oc_command_file";
			data: {
				name: string;
				path: string;
				source: "project" | "user";
				content: string;
			};
			requestId?: string;
	  }
	| {
			type: "oc_command_file_saved";
			data: { ok: boolean; path?: string };
			requestId?: string;
	  }
	| {
			type: "oc_command_file_deleted";
			data: { ok: boolean };
			requestId?: string;
	  }
	| {
			type: "oc_agent_files";
			data: Array<{
				name: string;
				path: string;
				source: "project" | "user";
				description?: string;
			}>;
			requestId?: string;
	  }
	| {
			type: "oc_agent_file";
			data: {
				name: string;
				path: string;
				source: "project" | "user";
				content: string;
			};
			requestId?: string;
	  }
	| {
			type: "oc_agent_file_saved";
			data: { ok: boolean; path?: string };
			requestId?: string;
	  }
	| { type: "oc_agent_file_deleted"; data: { ok: boolean }; requestId?: string }
	// Feature 4: Session Delete
	| {
			type: "session_deleted";
			data: boolean;
			sessionId: string;
			requestId?: string;
	  }
	// Feature 5: Session Update (Rename)
	| {
			type: "session_updated";
			data: SessionSummary;
			sessionId: string;
			requestId?: string;
	  }
	// Feature 6: Session Fork
	| { type: "session_forked"; data: SessionSummary; requestId?: string }
	| {
			type: "session_children";
			data: SessionSummary[];
			sessionId: string;
			requestId?: string;
	  }
	// Feature 7: Message Revert (Undo)
	| {
			type: "message_reverted";
			data: SessionSummary;
			sessionId: string;
			requestId?: string;
	  }
	| {
			type: "session_unreverted";
			data: SessionSummary;
			sessionId: string;
			requestId?: string;
	  }
	// Feature 8: Session Share
	| {
			type: "session_shared";
			data: SessionSummary;
			sessionId: string;
			requestId?: string;
	  }
	| {
			type: "session_unshared";
			data: SessionSummary;
			sessionId: string;
			requestId?: string;
	  }
	// Feature 9: Session Summarize (Compact)
	| {
			type: "session_summarized";
			data: boolean;
			sessionId: string;
			requestId?: string;
	  };
