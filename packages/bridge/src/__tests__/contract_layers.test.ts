import { describe, expect, test } from "bun:test";
import { layerViolations } from "../../scripts/contract-gen/layers";

const SRC = "/repo/src";

function check(path: string, source: string): string[] {
	return layerViolations(SRC, [{ path: `${SRC}/${path}`, source }]);
}

describe("the layer check", () => {
	test("lets the contract import zod and itself", () => {
		expect(check("contract/events.ts", 'import { z } from "zod";\nimport type { RunId } from "./ids";')).toEqual([]);
		expect(check("contract/testing/run.ts", 'import { test } from "bun:test";\nimport { x } from "../ids";')).toEqual(
			[],
		);
	});

	test("stops the contract importing anything else, type imports and multi-line imports included", () => {
		expect(check("contract/events.ts", 'import type { ServerMessage } from "../types";')).toEqual([
			"contract/events.ts: ../types leaves src/contract",
		]);
		expect(check("contract/events.ts", 'import {\n\treadFileSync,\n} from "node:fs";')).toEqual([
			"contract/events.ts: node:fs is not zod",
		]);
		expect(check("contract/events.ts", 'import { test } from "bun:test";')).toEqual([
			"contract/events.ts: bun:test is not zod",
		]);
		expect(check("contract/events.ts", 'const m = await import("../server");')).toEqual([
			"contract/events.ts: ../server leaves src/contract",
		]);
	});

	test("lets an adapter import the contract, itself, node and its own SDK", () => {
		const source = [
			'import type { AgentBackend } from "../../contract";',
			'import { mapEvent } from "./events";',
			'import { spawn } from "node:child_process";',
			'import { query } from "@anthropic-ai/claude-agent-sdk";',
		].join("\n");
		expect(check("backends/claude-code/index.ts", source)).toEqual([]);
	});

	test("stops an adapter importing another adapter, the core, another SDK or the contract's test kit", () => {
		const source = [
			'import { x } from "../pi/sessions";',
			'import { y } from "../../server";',
			'import { createAgentSession } from "@earendil-works/pi-coding-agent";',
			'import { createFakeBackend } from "../../contract/testing/fake-backend";',
		].join("\n");
		expect(check("backends/claude-code/index.ts", source)).toEqual([
			"backends/claude-code/index.ts: ../pi/sessions is neither this backend nor the contract",
			"backends/claude-code/index.ts: ../../server is neither this backend nor the contract",
			"backends/claude-code/index.ts: @earendil-works/pi-coding-agent is not this backend's SDK",
			"backends/claude-code/index.ts: ../../contract/testing/fake-backend is neither this backend nor the contract",
		]);
	});

	test("sees a template-literal import, and refuses an import it cannot read", () => {
		expect(check("contract/a.ts", "const m = await import(`../server`);")).toEqual([
			"contract/a.ts: ../server leaves src/contract",
		]);
		expect(check("contract/a.ts", "const m = await import(name);")).toEqual([
			"contract/a.ts: an import whose specifier is not a plain string",
		]);
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the string is source code holding a template literal
		expect(check("contract/a.ts", "const m = await import(`../${name}`);")).toEqual([
			"contract/a.ts: an import whose specifier is not a plain string",
		]);
		expect(check("backends/pi/a.ts", "const m = import.meta.require(name);")).toEqual([
			"backends/pi/a.ts: an import whose specifier is not a plain string",
		]);
		expect(check("backends/pi/a.ts", 'const m = require("../codex/x");')).toEqual([
			"backends/pi/a.ts: ../codex/x is neither this backend nor the contract",
		]);
	});

	test("refuses createRequire, which loads what it cannot see", () => {
		expect(check("backends/pi/a.ts", 'import { createRequire } from "node:module";')).toEqual([
			"backends/pi/a.ts: node:module loads modules this check cannot see",
		]);
	});

	test("reads imports, not comments or strings", () => {
		const source = [
			"/* import x from '../server' */",
			'// import y from "../server"',
			"const s = \"import('../str')\";",
			'const t = `require("../tpl")`;',
			'const r = /import\\("..\\/re"\\)/;',
			'import { z } from "zod";',
		].join("\n");
		expect(check("contract/a.ts", source)).toEqual([]);
	});

	test("sees type-only re-exports and inline type imports", () => {
		expect(check("contract/a.ts", 'export type { ServerMessage } from "../types";')).toEqual([
			"contract/a.ts: ../types leaves src/contract",
		]);
		expect(check("contract/a.ts", 'import { type A } from "../types";')).toEqual([
			"contract/a.ts: ../types leaves src/contract",
		]);
		expect(check("contract/a.ts", 'export * as all from "../types";')).toEqual([
			"contract/a.ts: ../types leaves src/contract",
		]);
	});

	test("lets Pi and Pi Durable share backends/pi-shared, and nobody else", () => {
		const shared = 'import { runtime } from "../pi-shared/model-runtime";';
		expect(check("backends/pi/index.ts", shared)).toEqual([]);
		expect(check("backends/pi-durable/index.ts", shared)).toEqual([]);
		expect(check("backends/codex/index.ts", shared)).toEqual([
			"backends/codex/index.ts: ../pi-shared/model-runtime is neither this backend nor the contract",
		]);
		expect(check("backends/pi-shared/model-runtime.ts", 'import { x } from "../pi/sessions";')).toEqual([
			"backends/pi-shared/model-runtime.ts: ../pi/sessions is neither this backend nor the contract",
		]);
		expect(
			check("backends/pi-shared/model-runtime.ts", 'import { ModelRuntime } from "@earendil-works/pi-coding-agent";'),
		).toEqual([]);
	});

	test("only backend ids are adapter directories", () => {
		expect(check("backends/cursor/index.ts", "")).toEqual([
			"backends/cursor/index.ts: cursor is not a backend id directory",
		]);
		expect(check("backends/index.ts", "")).toEqual(["backends/index.ts: index.ts is not a backend id directory"]);
	});

	test("ignores the rest of the bridge", () => {
		expect(check("server.ts", 'import { x } from "anything";')).toEqual([]);
	});
});
