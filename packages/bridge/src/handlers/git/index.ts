import type { GitMessage } from "../../routing/messages";
import { registerLegacy } from "../../routing/registry";
import type { MessageRouter, ServerDeps } from "../../routing/types";
import { handleGitCommand } from "./git_commands";
import { handleGithubCommand } from "./github_commands";
import type { GitHandlerContext, GitReply } from "./types";

const GIT_OPS = [
	"git_diff",
	"git_status",
	"git_log",
	"git_branches",
	"git_stage",
	"git_unstage",
	"git_revert_file",
	"git_commit",
	"git_push",
	"git_pull",
	"git_fetch",
	"git_checkout",
	"git_create_branch",
	"git_stash",
	"git_stash_pop",
	"git_commit_diff",
	"git_review_diff",
] as const;

const GITHUB_OPS = ["github_remote", "github_issues", "github_prs", "github_pr_diff", "github_pr_comments"] as const;

export const MODULE_TYPES = [...GIT_OPS, ...GITHUB_OPS] as const;

export function register(router: MessageRouter, deps: ServerDeps): void {
	const ctx: GitHandlerContext = { getSecurePath: deps.getSecurePath, safeString: deps.safeString };
	registerLegacy(router, GIT_OPS, handleGitCommand, () => ctx);
	registerLegacy(router, GITHUB_OPS, handleGithubCommand, () => ctx);
}

export async function handleGitFeature(message: GitMessage, reply: GitReply, ctx: GitHandlerContext): Promise<boolean> {
	if (String(message?.type || "").startsWith("github_")) {
		return handleGithubCommand(message, reply, ctx);
	}
	return handleGitCommand(message, reply, ctx);
}
