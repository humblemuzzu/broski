import { stat } from "node:fs/promises";
import type { Rejected } from "../contract";
import { pathRefusal, type SecurePath } from "../core/secure-path";
import { fileSystemRejection } from "./files/errors";
import { rejected } from "./results";

/** The bridge's path policy: `resolveSecurePath` in production. */
export type PathPolicy = (path: string) => Promise<SecurePath>;

export type AllowedPath = { readonly status: "allowed"; readonly path: string } | Rejected;

/** `path` as the policy allows it, canonical, or the refusal a phone can show. */
export async function allowedPath(policy: PathPolicy, path: string): Promise<AllowedPath> {
	const secure = await policy(path);
	return "path" in secure ? { status: "allowed", path: secure.path } : pathRefusal(path, secure.refused);
}

/** `allowedPath`, for a path that must be a directory. */
export async function allowedDirectory(policy: PathPolicy, path: string): Promise<AllowedPath> {
	const allowed = await allowedPath(policy, path);
	if (allowed.status === "rejected") return allowed;
	try {
		const stats = await stat(allowed.path);
		return stats.isDirectory() ? allowed : rejected("invalid_input", `${allowed.path} is not a directory`);
	} catch (error) {
		return fileSystemRejection(error, allowed.path);
	}
}
