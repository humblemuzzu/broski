import type { Rejected } from "../contract";
import type { DirectoryPolicy } from "./ports";
import { pathRefusal } from "./secure-path";

export type AllowedDirectory = { status: "allowed"; cwd: string } | Rejected;

/**
 * A request's working directory as the bridge's directory policy (`resolveSecurePath` in production)
 * allows it: canonical, or refused as the policy refused it.
 */
export async function allowedDirectory(policy: DirectoryPolicy, cwd: string): Promise<AllowedDirectory> {
	const secure = await policy(cwd);
	return "path" in secure ? { status: "allowed", cwd: secure.path } : pathRefusal(cwd, secure.refused);
}

/** The same for a directory a request may leave out. */
export async function allowedOptionalDirectory(
	policy: DirectoryPolicy,
	cwd: string | undefined,
): Promise<AllowedDirectory | undefined> {
	return cwd === undefined ? undefined : allowedDirectory(policy, cwd);
}
