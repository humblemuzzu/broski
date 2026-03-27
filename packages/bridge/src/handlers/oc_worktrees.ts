import type { ClientMessage, ServerMessage } from "../types";

type Reply = (message: ServerMessage) => void;

type OpenCodeWorktreeLike = {
	listWorktrees: (dir?: string) => Promise<any[]>;
	createWorktree: (name?: string, startCommand?: string, dir?: string) => Promise<any>;
	resetWorktree: (wtDir: string, dir?: string) => Promise<boolean>;
	deleteWorktree: (wtDir: string, dir?: string) => Promise<boolean>;
};

export async function handle(
	message: ClientMessage & { requestId?: string },
	reply: Reply,
	requireOpenCode: () => OpenCodeWorktreeLike,
): Promise<boolean> {
	switch (message.type) {
		case "list_worktrees": {
			const oc = requireOpenCode();
			const worktrees = await oc.listWorktrees(message.projectPath);
			reply({ type: "worktrees", data: worktrees });
			return true;
		}
		case "create_worktree": {
			const oc = requireOpenCode();
			const worktree = await oc.createWorktree(message.name, message.startCommand, message.projectPath);
			if (worktree) {
				reply({ type: "worktree_created", data: worktree });
			} else {
				reply({ type: "error", message: "Failed to create worktree" });
			}
			return true;
		}
		case "reset_worktree": {
			const oc = requireOpenCode();
			const success = await oc.resetWorktree(message.worktreeDirectory, message.projectPath);
			reply({
				type: "worktree_reset",
				data: success,
				worktreeDirectory: message.worktreeDirectory,
			});
			return true;
		}
		case "delete_worktree": {
			const oc = requireOpenCode();
			const deleted = await oc.deleteWorktree(message.name, message.projectPath);
			reply({ type: "worktree_deleted", data: deleted, name: message.name });
			return true;
		}
		default:
			return false;
	}
}
