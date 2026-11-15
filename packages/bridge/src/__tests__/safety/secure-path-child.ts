/** Probe for `security_temp_roots.test.ts`: the path policy's verdict for each argv path, as JSON. */

import type { SecurePath } from "../../core/secure-path";
import { resolveSecurePath } from "../../security";

const results: Record<string, SecurePath> = {};
for (const path of process.argv.slice(2)) {
	results[path] = await resolveSecurePath(path);
}
console.log(JSON.stringify(results));
