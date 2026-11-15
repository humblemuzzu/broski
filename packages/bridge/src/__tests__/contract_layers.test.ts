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

	test("lets an adapter import the contract, itself, node, zod and its own SDK", () => {
		const source = [
			'import type { AgentBackend } from "../../contract";',
			'import { mapEvent } from "./events";',
			'import { spawn } from "node:child_process";',
			'import { query } from "@anthropic-ai/claude-agent-sdk";',
			'import { z } from "zod";',
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
		expect(check("backends/pi/a.ts", 'const m = require("../claude-code/x");')).toEqual([
			"backends/pi/a.ts: ../claude-code/x is neither this backend nor the contract",
		]);
	});

	test("the Pi adapter has no SDK: it drives the user's `pi`, so no Pi package is imported", () => {
		expect(check("backends/pi/live/a.ts", 'import { x } from "@earendil-works/pi-coding-agent";')).toEqual([
			"backends/pi/live/a.ts: @earendil-works/pi-coding-agent is not this backend's SDK",
		]);
	});

	test("the extension the adapter writes for `pi` imports only Pi's packages, node and itself", () => {
		const agentSide = [
			'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
			'import { validateToolArguments } from "@earendil-works/pi-ai";',
			'import { readFileSync } from "node:fs";',
			'import { x } from "./b";',
		].join("\n");
		expect(check("backends/pi/host/extension/index.ts", agentSide)).toEqual([]);
		const leaving = ['import { z } from "zod";', 'import type { A } from "../../../../contract";'].join("\n");
		expect(check("backends/pi/host/extension/index.ts", leaving)).toEqual([
			"backends/pi/host/extension/index.ts: zod is not the agent's package",
			"backends/pi/host/extension/index.ts: ../../../../contract leaves the extension",
		]);
	});

	test("the rest of the adapter reads the extension only as text, never runs it", () => {
		expect(
			check("backends/pi/host/install.ts", 'import source from "./extension/index.ts" with { type: "text" };'),
		).toEqual([]);
		expect(check("backends/pi/host/install.ts", 'import { x } from "./extension/index";')).toEqual([
			"backends/pi/host/install.ts: ./extension/index is agent code, read only as text",
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

	test("an adapter reaches no other adapter's directory", () => {
		expect(check("backends/claude-code/index.ts", 'import { x } from "../pi/sessions";')).toEqual([
			"backends/claude-code/index.ts: ../pi/sessions is neither this backend nor the contract",
		]);
	});

	test("only backend ids are adapter directories", () => {
		expect(check("backends/cursor/index.ts", "")).toEqual([
			"backends/cursor/index.ts: cursor is not a backend id directory",
		]);
		expect(check("backends/index.ts", "")).toEqual(["backends/index.ts: index.ts is not a backend id directory"]);
	});

	test("lets the core import itself, the contract, zod and its listed infrastructure", () => {
		const source = [
			'import { LiveSession } from "./live-session";',
			'import { applyEvent } from "../contract";',
			'import type { SessionSnapshot } from "../contract/snapshot";',
			'import { z } from "zod";',
			'import { BoundedMap } from "../state/bounded-map";',
			'import { frameBytes } from "../transport/send-limits.ts";',
		].join("\n");
		expect(check("core/session-hub.ts", source)).toEqual([]);
		expect(check("core/ports.ts", 'import type { BridgeLogger } from "../logging/logger";')).toEqual([
			"core/ports.ts: ../logging/logger is neither the core, the contract nor the core's infrastructure",
		]);
	});

	test("judges the core's infrastructure too, so the core reaches nothing through it", () => {
		expect(
			check("state/bounded-map.ts", 'import { z } from "zod";\nimport { frameBytes } from "../transport/send-limits";'),
		).toEqual([]);
		const source = [
			'import { createBridgeState } from "../server/state";',
			'import type { BridgeLogger } from "../logging/logger";',
			'import { readFileSync } from "node:fs";',
		].join("\n");
		const outside = "is not the core's infrastructure, which the core reaches through this file";
		expect(check("transport/send-limits.ts", source)).toEqual([
			`transport/send-limits.ts: ../server/state ${outside}`,
			`transport/send-limits.ts: ../logging/logger ${outside}`,
			"transport/send-limits.ts: node:fs is not zod",
		]);
		expect(check("transport/other.ts", 'import { x } from "../server/state";')).toEqual([]);
	});

	test("stops the core importing the workspace, the logger, adapters, the server or the contract's test kit", () => {
		const source = [
			'import { x } from "../workspace/workspace-host";',
			'import { y } from "../logging/logger";',
			'import { z } from "../security";',
			'import { a } from "../backends/claude-code/index";',
			'import { b } from "../server/state";',
			'import type { BridgeLimits } from "../server/limits";',
			'import { createFakeBackend } from "../contract/testing/fake-backend";',
			'import { SendQueue } from "../transport/send-queue";',
			'import { readFileSync } from "node:fs";',
			'import { query } from "@anthropic-ai/claude-agent-sdk";',
		].join("\n");
		const outside = "is neither the core, the contract nor the core's infrastructure";
		expect(check("core/hub.ts", source)).toEqual([
			`core/hub.ts: ../workspace/workspace-host ${outside}`,
			`core/hub.ts: ../logging/logger ${outside}`,
			`core/hub.ts: ../security ${outside}`,
			`core/hub.ts: ../backends/claude-code/index ${outside}`,
			`core/hub.ts: ../server/state ${outside}`,
			`core/hub.ts: ../server/limits ${outside}`,
			`core/hub.ts: ../contract/testing/fake-backend ${outside}`,
			`core/hub.ts: ../transport/send-queue ${outside}`,
			"core/hub.ts: node:fs is not zod",
			"core/hub.ts: @anthropic-ai/claude-agent-sdk is not zod",
		]);
		expect(check("core/a.ts", "const m = await import(name);")).toEqual([
			"core/a.ts: an import whose specifier is not a plain string",
		]);
	});

	test("stops an adapter importing the core", () => {
		expect(check("backends/pi/index.ts", 'import { BridgeCore } from "../../core/core";')).toEqual([
			"backends/pi/index.ts: ../../core/core is neither this backend nor the contract",
		]);
	});

	test("ignores the rest of the bridge", () => {
		expect(check("server.ts", 'import { x } from "anything";')).toEqual([]);
	});
});
