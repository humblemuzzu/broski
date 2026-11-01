/**
 * The ops protocol 1.4 added, as the core serves them: the configuration, list and custom tool ops, the kinds Claude
 * Code serves that another backend served before (a client of an older minor is told of none of them), and the
 * project directory an op names, which reaches the adapter as the directory policy allows it.
 */

import { describe, expect, test } from "bun:test";
import {
	type AgentBackend,
	type BackendCall,
	CONFIG_OP_KINDS,
	CUSTOM_TOOL_OP_KINDS,
	LIST_OP_KINDS,
	MAX_PATH_CHARS,
	type ProtocolVersion,
} from "../contract";
import type { FakeBackendOptions } from "../contract/testing/fake-backend";
import { CLAUDE_CODE_OPS, FULL_TRAITS } from "../contract/testing/fake-data";
import { RIG_CWD, startCoreRig } from "./helpers/core-rig";

const MINOR_THREE = { major: 1, minor: 3 } as const;
const NEW_KINDS = [...CONFIG_OP_KINDS, ...LIST_OP_KINDS, ...CUSTOM_TOOL_OP_KINDS];
const JOINED_KINDS = ["session_settings", "changed_files", "refresh_models"] as const;

const claudeCodeFake: FakeBackendOptions = {
	id: "claude-code",
	traits: { ...FULL_TRAITS, backendOps: [...CLAUDE_CODE_OPS] },
};

async function listedOps(protocol?: ProtocolVersion) {
	const rig = await startCoreRig({ fake: claudeCodeFake });
	const listed = await (await rig.client("app", protocol)).ok("backends.list", {});
	return listed.backends.flatMap((backend) => backend.capabilities.backendOps);
}

describe("the ops a client is told of", () => {
	test("are every op of the backend for a client of this minor", async () => {
		expect(await listedOps()).toEqual([...CLAUDE_CODE_OPS]);
	});

	test("leave out, for a client of minor 3, what 1.4 added and the kinds that joined this backend in 1.4", async () => {
		const listed = await listedOps(MINOR_THREE);
		expect(listed).toEqual(["rewind_files"]);
		for (const kind of [...NEW_KINDS, ...JOINED_KINDS]) expect(listed).not.toContain(kind);
	});

	test("keep, for a client of minor 3, a kind its backend served in 1.3", async () => {
		const rig = await startCoreRig({
			adapt: (backend) => ({ ...backend, traits: { ...backend.traits, backendOps: [...JOINED_KINDS] } }),
		});
		const listed = await (await rig.client("app", MINOR_THREE)).ok("backends.list", {});
		expect(listed.backends.flatMap((backend) => backend.capabilities.backendOps)).toEqual([...JOINED_KINDS]);
	});
});

describe("the extensions a client is told of", () => {
	async function listedExtensions(protocol?: ProtocolVersion, backendOps = [...CLAUDE_CODE_OPS]) {
		const rig = await startCoreRig({
			fake: claudeCodeFake,
			adapt: (backend) => ({
				...backend,
				traits: { ...backend.traits, backendOps, extensions: ["rate_limit", "prompt_suggestion"] },
			}),
		});
		const listed = await (await rig.client("app", protocol)).ok("backends.list", {});
		return listed.backends.flatMap((backend) => backend.capabilities.extensions);
	}

	test("are every extension the backend declares for a client of this minor", async () => {
		expect(await listedExtensions()).toEqual(["rate_limit", "prompt_suggestion"]);
	});

	test("leave out, for a client of minor 3, the prompt_suggestion kind 1.4 added", async () => {
		expect(await listedExtensions(MINOR_THREE)).toEqual(["rate_limit"]);
		expect(await listedExtensions(MINOR_THREE, ["rewind_files"])).toEqual(["rate_limit"]);
	});
});

describe("an op that names a project directory", () => {
	const recording = (calls: BackendCall[]) => (backend: AgentBackend) => ({
		...backend,
		call: async (call: BackendCall) => {
			calls.push(call);
			if (!backend.call) throw new Error("the fake has call");
			return backend.call(call);
		},
	});
	const policy = async (path: string) => (path === RIG_CWD ? "/real/project" : undefined);

	test("reaches the adapter with the directory as the policy allows it", async () => {
		const calls: BackendCall[] = [];
		const rig = await startCoreRig({ fake: claudeCodeFake, adapt: recording(calls), core: { directories: policy } });
		const phone = await rig.client("phone");
		const answer = await phone.ok("backend.call", {
			call: { backend: "claude-code", op: { kind: "config_files", cwd: RIG_CWD } },
		});
		expect(answer.result.status).toBe("accepted");
		expect(calls.map((call) => call.op)).toEqual([{ kind: "config_files", cwd: "/real/project" }]);
	});

	test("is refused invalid_input, before the adapter sees it, outside the directories the bridge serves", async () => {
		const calls: BackendCall[] = [];
		const rig = await startCoreRig({ fake: claudeCodeFake, adapt: recording(calls), core: { directories: policy } });
		const phone = await rig.client("phone");
		const answer = await phone.ok("backend.call", {
			call: { backend: "claude-code", op: { kind: "plugins", cwd: "/etc" } },
		});
		expect(answer.result.status === "rejected" && answer.result.rejection).toEqual({
			code: "invalid_input",
			message: "/etc is not a directory this bridge serves",
		});
		expect(calls).toEqual([]);
	});

	test("is refused invalid_input when the directory it resolves to is longer than the contract carries", async () => {
		const calls: BackendCall[] = [];
		const long = async () => `/${"d".repeat(MAX_PATH_CHARS)}`;
		const rig = await startCoreRig({ fake: claudeCodeFake, adapt: recording(calls), core: { directories: long } });
		const phone = await rig.client("phone");
		const answer = await phone.ok("backend.call", {
			call: { backend: "claude-code", op: { kind: "settings_overview", cwd: RIG_CWD } },
		});
		expect(answer.result.status === "rejected" && answer.result.rejection.code).toBe("invalid_input");
		expect(calls).toEqual([]);
	});

	test("that names none reaches the adapter as sent", async () => {
		const calls: BackendCall[] = [];
		const rig = await startCoreRig({ fake: claudeCodeFake, adapt: recording(calls), core: { directories: policy } });
		const phone = await rig.client("phone");
		await phone.ok("backend.call", { call: { backend: "claude-code", op: { kind: "custom_tools" } } });
		expect(calls.map((call) => call.op)).toEqual([{ kind: "custom_tools" }]);
	});
});
