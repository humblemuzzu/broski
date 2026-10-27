import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { loadPiCodingAgent, piCodingAgent } from "../../sdk/pi-coding-agent";

export async function piSessionsRoot(): Promise<string> {
	await loadPiCodingAgent();
	return resolve(piCodingAgent().getAgentDir(), "sessions");
}

/**
 * [candidate] as a real absolute path when it is a file inside the Pi sessions root, or null.
 *
 * The phone may name a transcript itself, so this is what keeps it naming one: realpath on both
 * sides defeats `..` and a symlink out of the root.
 */
export async function securePiSessionPath(candidate: string, root?: string): Promise<string | null> {
	const base = await realpath(root ?? (await piSessionsRoot())).catch(() => null);
	if (!base) return null;
	const target = await realpath(resolve(candidate)).catch(() => null);
	if (!target || (target !== base && !target.startsWith(`${base}${sep}`))) return null;
	const info = await stat(target).catch(() => null);
	return info?.isFile() ? target : null;
}
