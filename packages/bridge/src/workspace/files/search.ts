import { type FileMatch, type FsSearchResult, MAX_PATH_CHARS } from "../../contract";
import { searchFilesAndDirs } from "./file-search";

/** Files and directories under `root` (a directory past the path policy) whose path matches `query` by name. */
export async function searchFiles(root: string, query: string, limit: number): Promise<FsSearchResult> {
	const found = await searchFilesAndDirs({ query, cwd: root, limit });
	const matches = found.flatMap((path): FileMatch[] => {
		const match: FileMatch = path.endsWith("/") ? { path: path.slice(0, -1), kind: "dir" } : { path, kind: "file" };
		return match.path.length <= MAX_PATH_CHARS ? [match] : [];
	});
	return { status: "accepted", root, matches };
}
