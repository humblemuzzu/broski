/**
 * Arms the real-home guard for every `bun test` run, whose instrumented write sites throw
 * `RealHomeWriteError` rather than edit the developer's live `~/.claude`, `~/.pi` or
 * `~/.broski`.
 */

import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { captureRealHome, TEST_ISOLATION_ENV } from "../../safety/real-home-guard";

captureRealHome();
process.env[TEST_ISOLATION_ENV] = "1";
// macOS resolves the temp dir through /private, which the default allowlist's /tmp does not match.
process.env.BROSKI_ALLOWED_BASE_PATHS = [homedir(), realpathSync(tmpdir())].join(",");
