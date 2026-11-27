/**
 * The Antigravity backend in a real bridge, on a Mac where `agy` is not installed (no `agy` is ever started here): the
 * core takes its descriptor and adds its steer and queue but no fork, since its portable fork would write a prompt of
 * the bridge's own into agy; the status says what to install, and every read answers why it cannot.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityBackendFactory } from "../../backends/antigravity/factory";
import { AGY_INSTALL_FIX } from "../../backends/antigravity/install";
import { fileLock } from "../../platform/file-lock";
import { fitImageBase64 } from "../../platform/image-fit";
import { journalsIn } from "../../server/json-lines-journal";
import { E2E_TEST_TIMEOUT_MS, startBridge } from "../e2e/harness";
import { connectPhone } from "../helpers/link-contract-client";

let root: string | undefined;

afterEach(() => {
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("a bridge with Antigravity and no agy", () => {
	test(
		"lists Antigravity, says to install it, and refuses each read with that reason",
		async () => {
			root = realpathSync(mkdtempSync(join(tmpdir(), "broski-agy-registration-")));
			const voidDir = join(root, "void");
			const factory = antigravityBackendFactory({
				install: {
					cli: { found: false, reason: `agy is not here. ${AGY_INSTALL_FIX}` },
					env: {},
					voidDir,
					presenceDir: join(root, "presence"),
				},
				bridgeVersion: "0.0.0-test",
				fileLock,
				fitImage: fitImageBase64,
				journal: journalsIn(join(root, "journals"), () => undefined),
				log: () => undefined,
			});
			const socketPath = join(root, "link.sock");
			const bridge = await startBridge({
				linkSocket: socketPath,
				contract: { backends: [["antigravity", factory]], journalDirectory: join(root, "journals") },
			});
			const phone = await connectPhone(socketPath, "phone");
			await phone.hello();
			try {
				const listed = await phone.ok("backends.list", {});
				expect(listed.backends).toEqual([
					{
						id: "antigravity",
						displayName: "Antigravity",
						accentHex: "#1A73E8",
						iconHint: "antigravity",
						capabilities: expect.objectContaining({
							fork: false,
							rename: false,
							delete: false,
							promptModes: ["start", "steer", "queue"],
							interactions: ["questions", "tool_permission"],
						}),
					},
				]);
				const status = await phone.ok("backend.status", { backend: "antigravity" });
				expect(status.status).toEqual({
					installed: false,
					auth: "unknown",
					usable: false,
					issues: [{ severity: "error", message: `agy is not here. ${AGY_INSTALL_FIX}` }],
				});
				const models = await phone.ok("models.list", { backend: "antigravity", cwd: root });
				expect(models.result).toMatchObject({
					status: "rejected",
					rejection: { code: "backend_error", message: expect.stringContaining("agy is not here") },
				});
				const sessions = await phone.ok("sessions.list", { backend: "antigravity", query: {}, page: { limit: 5 } });
				expect(sessions.result).toMatchObject({ status: "rejected", rejection: { code: "backend_error" } });
				const fork = await phone.ok("session.fork", { session: { backend: "antigravity", sessionId: "any" } });
				expect(fork.result).toMatchObject({ status: "rejected", rejection: { code: "unsupported" } });
				expect(existsSync(voidDir)).toBe(false);
			} finally {
				await bridge.stop();
			}
		},
		E2E_TEST_TIMEOUT_MS,
	);
});
