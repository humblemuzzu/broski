import { findBinary } from "../../platform";
import { type AllowedPath, allowedDirectory, allowedPath, type PathPolicy } from "../paths";
import { rejected } from "../results";
import { git } from "./command";

/**
 * The top directory of the repository `cwd` lies in, which every git command runs in and every path is relative
 * to. Both `cwd` and the top directory must pass the path policy: a repository reaching above the folders the
 * bridge serves is refused, since its paths would name files outside them.
 */
export async function repositoryRoot(policy: PathPolicy, cwd: string): Promise<AllowedPath> {
	if (findBinary("git") === null) return rejected("unsupported", "git is not installed on this machine");
	const directory = await allowedDirectory(policy, cwd);
	if (directory.status === "rejected") return directory;
	const top = await git(["rev-parse", "--show-toplevel"], directory.path, "");
	if (top.status === "rejected") {
		return top.rejection.code === "invalid_input"
			? rejected("not_found", `${directory.path} is not inside a git work tree`)
			: top;
	}
	return allowedPath(policy, top.stdout.trim());
}
