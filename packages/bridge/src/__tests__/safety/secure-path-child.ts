/** Probe for `security_temp_roots.test.ts`: the allowlisted path for each argv path, as JSON. */

import { getSecurePath } from "../../security";

const results: Record<string, string | null> = {};
for (const path of process.argv.slice(2)) {
	results[path] = await getSecurePath(path);
}
console.log(JSON.stringify(results));
