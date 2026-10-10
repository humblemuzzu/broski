import { basename, isAbsolute, join } from "node:path";
import type { Workspace as OpenCodeWorkspace } from "@opencode-ai/sdk/v2";
import type { Worktree } from "../../types";
import type { OpenCodeContext } from "./context";

export async function listWorktrees(ctx: OpenCodeContext, directory?: string): Promise<Worktree[]> {
	try {
		// The SDK returns an array of directory strings, not full Worktree objects
		const { data: result } = await ctx.client.worktree.list({ directory });
		const dirs = result ?? [];
		const concurrency = 6;
		const queue = dirs.slice();
		const out: Worktree[] = [];

		await Promise.all(
			Array.from({ length: Math.max(1, concurrency) }, async () => {
				for (;;) {
					const dir = queue.shift();
					if (!dir) break;
					let branch = "";
					try {
						const { data: vcs } = await ctx.client.vcs.get({ directory: dir });
						branch = vcs?.branch ?? "";
					} catch {
						branch = "";
					}
					out.push({
						name: basename(dir) || dir,
						branch,
						directory: dir,
					});
				}
			}),
		);

		return out.sort((a, b) => a.directory.localeCompare(b.directory));
	} catch (error) {
		console.error("[listWorktrees] Error:", error);
		return [];
	}
}

export async function createWorktree(
	ctx: OpenCodeContext,
	name?: string,
	startCommand?: string,
	directory?: string,
): Promise<Worktree | null> {
	try {
		const { data: result } = await ctx.client.worktree.create({
			directory,
			worktreeCreateInput: {
				name,
				startCommand,
			},
		});
		if (!result) return null;

		// The SDK creates the git worktree but does NOT register it in the project's
		// sandboxes array. Any API call against the new directory triggers
		// Instance.provide() -> Project.fromDirectory() -> sandboxes.push(), which
		// makes the worktree show up in listWorktrees() after app restart.
		if (result.directory) {
			try {
				await ctx.client.vcs.get({ directory: result.directory });
				console.log("[createWorktree] Registered sandbox:", result.directory);
			} catch {
				console.warn("[createWorktree] Failed to register sandbox, worktree may not persist in list");
			}
		}

		return {
			name: result.name ?? "",
			branch: result.branch ?? "",
			directory: result.directory ?? "",
		};
	} catch (error) {
		console.error("[createWorktree] Error:", error);
		return null;
	}
}

export async function resetWorktree(
	ctx: OpenCodeContext,
	worktreeDirectory: string,
	directory?: string,
): Promise<boolean> {
	try {
		if (!directory || directory.length === 0) return false;
		const target = isAbsolute(worktreeDirectory) ? worktreeDirectory : join(directory, worktreeDirectory);

		const { data: result } = await ctx.client.worktree.reset({
			directory,
			worktreeResetInput: { directory: target },
		});

		return result === true;
	} catch {
		return false;
	}
}

export async function deleteWorktree(
	ctx: OpenCodeContext,
	worktreeDirectory: string,
	directory?: string,
): Promise<boolean> {
	try {
		if (!directory || directory.length === 0) return false;
		const target = isAbsolute(worktreeDirectory) ? worktreeDirectory : join(directory, worktreeDirectory);

		const { data: result } = await ctx.client.worktree.remove({
			directory,
			worktreeRemoveInput: { directory: target },
		});

		return result === true;
	} catch {
		return false;
	}
}

export async function listWorkspaces(ctx: OpenCodeContext, directory?: string): Promise<OpenCodeWorkspace[]> {
	try {
		const { data: result } = await ctx.client.experimental.workspace.list({ directory });
		return result ?? [];
	} catch {
		return [];
	}
}

export async function createWorkspace(
	ctx: OpenCodeContext,
	id: string,
	options: { branch?: string | null; config?: { directory: string; type: "worktree" } },
	directory?: string,
): Promise<OpenCodeWorkspace | null> {
	try {
		const { data: result } = await ctx.client.experimental.workspace.create({
			id,
			directory,
			...(options.branch !== undefined ? { branch: options.branch } : {}),
			...(options.config ? { config: options.config } : {}),
		});
		return result ?? null;
	} catch {
		return null;
	}
}

export async function removeWorkspace(ctx: OpenCodeContext, id: string, directory?: string): Promise<boolean> {
	try {
		const { data: result } = await ctx.client.experimental.workspace.remove({ id, directory });
		return result != null;
	} catch {
		return false;
	}
}
