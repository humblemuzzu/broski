import { handleGitCommand } from "./git_commands";
import { handleGithubCommand } from "./github_commands";
import type { GitHandlerContext, GitReply } from "./types";

export async function handleGitFeature(message: any, reply: GitReply, ctx: GitHandlerContext): Promise<boolean> {
	if (String(message?.type || "").startsWith("github_")) {
		return handleGithubCommand(message, reply, ctx);
	}
	return handleGitCommand(message, reply, ctx);
}
