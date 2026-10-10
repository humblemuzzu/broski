import { homedir } from "node:os";
import { join } from "node:path";
import { CcFsWatcherRegistry, type CcFsWatchKind } from "../handlers/cc_fs_watchers";
import type { ServerMessage } from "../types";

export type FsWatchers = {
	registry: CcFsWatcherRegistry;
	ensureClaudeWatchDir: (dir: string, kind: CcFsWatchKind, cwd?: string, recursive?: boolean) => void;
	closeAll: () => void;
};

/** Claude Code filesystem watchers (skills/plugins/hook/command updates). */
export function createFsWatchers(deps: { broadcast: (message: ServerMessage) => void }): FsWatchers {
	const registry = new CcFsWatcherRegistry({
		onChange: (change) => {
			deps.broadcast({ type: "cc_fs_changed", data: change });
		},
	});

	const ensureClaudeWatchDir = (dir: string, kind: CcFsWatchKind, cwd?: string, recursive = true): void => {
		registry.ensure(dir, kind, cwd, recursive);
	};

	// Watch user-scope Claude Code skills (best-effort).
	ensureClaudeWatchDir(join(homedir(), ".claude", "skills"), "skills");

	return { registry, ensureClaudeWatchDir, closeAll: () => registry.closeAll() };
}
