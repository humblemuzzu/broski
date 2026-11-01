import { isAbsolute, join } from "node:path";
import { registerAll } from "../routing/registry";
import type { MessageRouter, ServerDeps } from "../routing/types";

const FILE_OPS = ["read_file", "read_file_binary", "browse", "search_files_and_dirs"] as const;

export const MODULE_TYPES = FILE_OPS;

function resolveInProject(path: string, projectPath?: string): string {
	return projectPath && !isAbsolute(path) ? join(projectPath, path) : path;
}

export function register(router: MessageRouter, deps: ServerDeps): void {
	registerAll(router, ["read_file"] as const, async (message, { reply }) => {
		const content = await deps.readFileDirectly(resolveInProject(message.path, message.projectPath));
		reply({ type: "file_content", data: content, path: message.path });
	});

	registerAll(router, ["read_file_binary"] as const, async (message, { reply }) => {
		const maxSizeMb = message.maxSizeMb ?? 10;
		const result = await deps.readFileBinaryDirectly(message.path, maxSizeMb);
		if (!("error" in result)) {
			reply({ type: "file_binary", data: result, path: message.path });
			return;
		}
		if (result.error === "too_large") {
			reply({
				type: "file_too_large",
				data: { path: message.path, size: result.size ?? 0, maxSize: maxSizeMb * 1024 * 1024 },
			});
			return;
		}
		reply({ type: "error", message: result.error === "access_denied" ? "Access denied" : "File not found" });
	});

	registerAll(router, ["browse"] as const, async (message, { reply }) => {
		const items = await deps.listFilesDirectly(message.path);
		reply({ type: "browse_result", data: { path: message.path, items } });
	});

	registerAll(router, ["search_files_and_dirs"] as const, async (message, { reply }) => {
		const cwd = message.projectPath;
		const results = cwd
			? await deps.fileSearch.searchFilesAndDirs({ query: message.query ?? "", cwd, limit: 50, includeDirs: true })
			: [];
		reply({ type: "files_and_dirs_found", data: results });
	});
}
