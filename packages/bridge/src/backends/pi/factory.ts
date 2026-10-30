/** The `BackendFactory` the bridge registers for `pi` (core README §16): shared services, then the backend. */

import type { BackendFactory } from "../../contract";
import { createPiBackend } from "./backend";
import { createPiServices, type PiServicesOptions } from "./services";

export function piBackendFactory(options: PiServicesOptions = {}): BackendFactory {
	return async (host) => createPiBackend(host, await createPiServices(options));
}
