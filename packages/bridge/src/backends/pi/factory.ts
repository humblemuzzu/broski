/** The `BackendFactory` the bridge registers for `pi` (core README §16): shared services, then the backend. */

import type { BackendFactory } from "../../contract";
import { createPiParts, piBackendOf } from "./backend";
import { createPiServices, type PiServicesOptions } from "./services";
import type { TerminalLinkOptions } from "./terminal/link";

export interface PiFactoryOptions extends PiServicesOptions {
	/** The link to terminal `pi` processes (`terminal/link.ts`); without it the adapter installs and listens to nothing. */
	readonly link?: TerminalLinkOptions;
}

export function piBackendFactory(options: PiFactoryOptions = {}): BackendFactory {
	return async (host) => {
		const parts = createPiParts(host, await createPiServices(options), options.link);
		await parts.terminal.start();
		return piBackendOf(parts);
	};
}
