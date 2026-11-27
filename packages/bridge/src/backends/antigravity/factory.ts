/** The `BackendFactory` the bridge registers for `antigravity` (core README §16). */

import type { BackendFactory } from "../../contract";
import { type AntigravityBackendOptions, antigravityBackendOf } from "./backend";

export type { AntigravityBackendOptions } from "./backend";

export function antigravityBackendFactory(options: AntigravityBackendOptions): BackendFactory {
	return async () => antigravityBackendOf(options);
}
