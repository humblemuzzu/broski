import { stat } from "node:fs/promises";
import type { Rejected } from "../contract";
import type { SecurePath } from "../security";
import { fileSystemRejection } from "./files/errors";
import { rejected } from "./results";

/** The bridge's path policy: `resolveSecurePath` in production. */
export type PathPolicy = (path: string) => Promise<SecurePath>;

export type AllowedPath = { readonly status: "allowed"; readonly path: string } | Rejected;

/** `path` as the policy allows it, canonical, or the refusal a phone can show. */
export async function allowedPath(policy: PathPolicy, path: string): Promise<AllowedPath> {
	const secure = await policy(path);
	if ("path" in secure) return { status: "allowed", path: secure.path };
	switch (secure.refused) {
		case "invalid":
			return rejected("invalid_input", `${JSON.stringify(path)} is not a path the bridge can use`);
		case "outside":
			return rejected("forbidden", `${path} is outside the folders this bridge serves`);
		case "missing":
			return rejected("not_found", `${path} does not exist`);
	}
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
