import type { Rejected } from "../../contract";
import { rejected } from "../results";

/** What a phone is told when the file system refused to open or read `path`. */
export function fileSystemRejection(error: unknown, path: string): Rejected {
	const code = error instanceof Error && "code" in error ? error.code : undefined;
	switch (code) {
		case "ENOENT":
			return rejected("not_found", `${path} does not exist`);
		case "ENOTDIR":
			return rejected("invalid_input", `${path} is not a directory`);
		case "EISDIR":
			return rejected("invalid_input", `${path} is a directory`);
		case "EACCES":
		case "EPERM":
			return rejected("forbidden", `the system does not let the bridge read ${path}`);
		case "ELOOP":
			// The path policy resolved every link, so one here was put in place after it looked.
			return rejected("forbidden", `${path} became a symbolic link while it was being opened`);
		default:
			return rejected("backend_error", `${path} could not be read: ${String(error)}`);
	}
}
