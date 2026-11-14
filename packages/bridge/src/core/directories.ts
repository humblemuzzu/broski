import type { Rejected } from "../contract";
import type { DirectoryPolicy } from "./ports";
import { rejected } from "./results";

export type AllowedDirectory = { status: "allowed"; cwd: string } | Rejected;

/**
 * A request's working directory as the bridge's directory policy (`getSecurePath` in production)
 * allows it: canonical, or refused `invalid_input`.
 */
export async function allowedDirectory(policy: DirectoryPolicy, cwd: string): Promise<AllowedDirectory> {
	const canonical = await policy(cwd);
	return canonical === undefined
		? rejected("invalid_input", `${cwd} is not a directory this bridge serves`)
		: { status: "allowed", cwd: canonical };
}

/** The same for a directory a request may leave out. */
export async function allowedOptionalDirectory(
	policy: DirectoryPolicy,
	cwd: string | undefined,
): Promise<AllowedDirectory | undefined> {
	return cwd === undefined ? undefined : allowedDirectory(policy, cwd);
}
