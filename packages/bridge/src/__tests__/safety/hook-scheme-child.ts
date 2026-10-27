/** Probe for `hook_scheme.test.ts`: installs both permission hooks for one scheme and port. */

import { installCcHook } from "../../handlers/cc_hook_installer";
import { installCxHook } from "../../handlers/cx_hook_installer";

const scheme = process.argv[2] === "http" ? "http" : "https";
const port = Number(process.argv[3]);

await installCcHook({ port, token: "hook-scheme-token", scheme });
await installCxHook({ port, token: "hook-scheme-token", scheme });
