/**
 * The short jobs' `agy` when it hangs, played by a shell script that writes one line that is not JSON and then sleeps
 * through stdin's end: it answers nothing and speaks no ACP. No `agy` is ever started here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STOP_BUDGET_MS } from "../../adapter-kit/stdio-child";
import { ShortJobs } from "../../backends/antigravity/jobs";
import { eventually } from "../helpers/workspace-rig";

const HUNG = '#!/bin/sh\necho "not JSON"\n: > "$0.started"\nexec /bin/sleep 600\n';

let root: string | undefined;
let jobs: ShortJobs | undefined;

afterEach(async () => {
	await jobs?.dispose();
	jobs = undefined;
	if (root !== undefined) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

function hungJobs(log: (message: string) => void) {
	root = realpathSync(mkdtempSync(join(tmpdir(), "broski-agy-jobs-")));
	const script = join(root, "agy");
	writeFileSync(script, HUNG, { mode: 0o755 });
	const install = {
		cli: { found: true as const, path: script },
		env: {},
		voidDir: join(root, "void"),
		presenceDir: join(root, "presence"),
	};
	jobs = new ShortJobs(install, { name: "broski", version: "0.0.0-test" }, log);
	return { jobs, started: () => existsSync(`${script}.started`) };
}

describe("the short jobs' agy", () => {
	test("a line it writes that is not JSON reaches the backend's log", async () => {
		const logged: string[] = [];
		const { jobs } = hungJobs((message) => logged.push(message));
		void jobs.run(async () => ({ ok: true, result: undefined }));
		expect(await eventually(() => logged[0], "the fault in the log", 5_000)).toBe("agy sent a line that is not JSON");
	});

	test("is stopped at once by dispose: the running job fails with its exit, the one queued behind it starts no other", async () => {
		const { jobs, started } = hungJobs(() => undefined);
		const ran: string[] = [];
		const running = jobs.run(async () => {
			ran.push("running");
			return { ok: true, result: undefined };
		});
		const queued = jobs.run(async () => {
			ran.push("queued");
			return { ok: true, result: undefined };
		});
		await eventually(started, "the hung agy to start");
		const disposing = performance.now();
		await jobs.dispose();
		expect(performance.now() - disposing).toBeLessThan(STOP_BUDGET_MS + 1_000);
		expect(await running).toEqual({
			ok: false,
			failure: { message: expect.stringMatching(/^agy was stopped by SIG(TERM|KILL)$/) },
		});
		expect(await queued).toEqual({ ok: false, failure: { message: "the Antigravity backend has shut down" } });
		expect(ran).toEqual([]);
	}, 45_000);
});
