import { piBackendFactory } from "../backends/pi/factory";
import { isCompiledBinary } from "../compiled-binary";
import type { ContractOptions } from "./contract-seam";

/** Serves Pi through the contract. Off by default; never in a compiled binary. */
export const CONTRACT_PI_FLAG = "BROSKI_CONTRACT_PI";

/**
 * The backends the bridge core serves. Pi joins only with `BROSKI_CONTRACT_PI=1` in a dev bridge, so the old Pi path
 * and this one never host one session file at once by accident; the old path serves Pi beside it, untouched.
 */
export function contractOptions(
	env: Readonly<Record<string, string | undefined>> = process.env,
	compiled: boolean = isCompiledBinary(),
): ContractOptions {
	return { backends: !compiled && env[CONTRACT_PI_FLAG] === "1" ? [["pi", piBackendFactory()]] : [] };
}
