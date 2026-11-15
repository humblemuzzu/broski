/** The `BackendFactory` the bridge registers for `pi` (core README §16). */

import type { BackendFactory } from "../../contract";
import { createPiParts, type PiBackendOptions, piBackendOf } from "./backend";

export type { PiBackendOptions } from "./backend";

export function piBackendFactory(options: PiBackendOptions): BackendFactory {
	return async (host) => {
		const parts = createPiParts(host, options);
		await parts.terminal.start();
		return piBackendOf(parts);
	};
}
