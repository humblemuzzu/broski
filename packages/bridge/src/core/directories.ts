import { BackendCall, type Rejected } from "../contract";
import type { DirectoryPolicy } from "./ports";
import { rejected } from "./results";

export type AllowedDirectory = { status: "allowed"; cwd: string } | Rejected;

/**
 * A request's working directory as the bridge's directory policy (`getSecurePath` in production)
 * allows it: canonical, or refused `invalid_input`, as the old protocol refuses it with "Access denied".
 */
export async function allowedDirectory(policy: DirectoryPolicy, cwd: string): Promise<AllowedDirectory> {
	const canonical = await policy(cwd);
	return canonical === undefined
		? rejected("invalid_input", `${cwd} is not a directory this bridge serves`)
		: { status: "allowed", cwd: canonical };
}

/** A backend call whose op names a project directory, with that directory as the policy allows it. */
export async function allowedCall(
	policy: DirectoryPolicy,
	call: BackendCall,
): Promise<{ status: "allowed"; call: BackendCall } | Rejected> {
	if (!("cwd" in call.op)) return { status: "allowed", call };
	const directory = await allowedDirectory(policy, call.op.cwd);
	if (directory.status === "rejected") return directory;
	const allowed = BackendCall.safeParse({ ...call, op: { ...call.op, cwd: directory.cwd } });
	return allowed.success
		? { status: "allowed", call: allowed.data }
		: rejected("invalid_input", `${call.op.cwd} resolves to a path the contract cannot carry`);
}

/** The same for a directory a request may leave out. */
export async function allowedOptionalDirectory(
	policy: DirectoryPolicy,
	cwd: string | undefined,
): Promise<AllowedDirectory | undefined> {
	return cwd === undefined ? undefined : allowedDirectory(policy, cwd);
}
