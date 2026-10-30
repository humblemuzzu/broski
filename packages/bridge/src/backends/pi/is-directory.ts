import { statSync } from "node:fs";

/** Whether `path` names a directory now, through symlinks; any failure to tell is no. */
export function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
