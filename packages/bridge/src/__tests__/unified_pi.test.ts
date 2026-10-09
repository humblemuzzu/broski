import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pi from "../connectors/pi";
import { handle as handleUnified, type UnifiedContext } from "../handlers/unified";
import {
	listPiDurableSkills,
	listPiSkills,
	mapPiCommandSkills,
	parsePiModelRef,
	setPiModel,
} from "../handlers/unified_pi";
import type { ServerMessage } from "../types";
import type { PiCommandPayload } from "../types/pi";

const SKILL_NAME = "broski-unified-skill-probe";

/** Providers with credentials configured in ~/.pi/agent/auth.json. */
const configuredProviders = await pi.listConfiguredProviders();
const hasConfiguredProvider = configuredProviders.length > 0;

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function writeSkill(root: string, name: string, disableModelInvocation = false): string {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "SKILL.md");
	writeFileSync(
		file,
		[
			"---",
			`name: ${name}`,
			`description: ${name} does things`,
			...(disableModelInvocation ? ["disable-model-invocation: true"] : []),
			"---",
			"Skill body.",
			"",
		].join("\n"),
	);
	return file;
}

function command(overrides: Partial<PiCommandPayload>): PiCommandPayload {
	return { name: "cmd", source: "skill", ...overrides };
}

function unused(): never {
	throw new Error("unified context method not used by this test");
}

const unifiedContext: UnifiedContext = {
	claudeCode: {
		listProjects: unused,
		listSessions: unused,
		deleteSession: unused,
		abortClaudeCode: unused,
		getSupportedModels: unused,
		listSkills: unused,
	},
	ensureCodexClient: unused,
	requireOpenCode: () => null,
	log: () => {},
};

async function callUnified(message: Record<string, unknown>): Promise<ServerMessage[]> {
	const replies: ServerMessage[] = [];
	await handleUnified(message, (reply: ServerMessage) => replies.push(reply), unifiedContext);
	return replies;
}

afterAll(() => {
	pi.disposeAll();
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// best-effort cleanup
		}
	}
});

describe("parsePiModelRef", () => {
	test("reads provider and modelId when both are sent", () => {
		expect(parsePiModelRef({ provider: "anthropic", modelId: "claude-sonnet" })).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet",
		});
	});

	test("splits a provider/modelId model string", () => {
		expect(parsePiModelRef({ model: "anthropic/claude-sonnet" })).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet",
		});
	});

	test("prefers provider + modelId over the model string", () => {
		expect(parsePiModelRef({ model: "openai/gpt-5", provider: "anthropic", modelId: "claude-sonnet" })).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet",
		});
	});

	test("rejects model strings that are not provider/modelId", () => {
		expect(parsePiModelRef({ model: "claude-sonnet" })).toBeUndefined();
		expect(parsePiModelRef({ model: "/claude-sonnet" })).toBeUndefined();
		expect(parsePiModelRef({ model: "anthropic/" })).toBeUndefined();
		expect(parsePiModelRef({ model: "  " })).toBeUndefined();
		expect(parsePiModelRef({})).toBeUndefined();
	});
});

describe("setPiModel request validation", () => {
	test("returns false without a model ref or thinking level", async () => {
		expect(await setPiModel({})).toBe(false);
		expect(await setPiModel({ model: "claude-sonnet" })).toBe(false);
		expect(await setPiModel({ provider: "anthropic" })).toBe(false);
	});
});

describe("mapPiCommandSkills", () => {
	test("keeps skills and drops prompts and extension commands", () => {
		const mapped = mapPiCommandSkills([
			command({ name: "review", source: "skill", location: "project", path: "/p/review/SKILL.md" }),
			command({ name: "ship", source: "skill", location: "user", path: "/u/ship/SKILL.md" }),
			command({ name: "deploy", source: "prompt", location: "project", path: "/p/deploy.md" }),
			command({ name: "ext", source: "extension", location: "user", path: "/u/ext.ts" }),
		]);

		expect(mapped).toEqual([
			{
				name: "review",
				description: undefined,
				source: "project",
				path: "/p/review/SKILL.md",
				autoInvoke: true,
			},
			{ name: "ship", description: undefined, source: "user", path: "/u/ship/SKILL.md", autoInvoke: true },
		]);
	});
});

describe("listPiDurableSkills", () => {
	test("loads project and user skills with their scope", async () => {
		const cwd = tempDir("broski-unified-durable-");
		const agentDir = tempDir("broski-unified-agent-");
		const projectSkill = writeSkill(join(cwd, ".pi", "skills"), SKILL_NAME);
		writeSkill(join(agentDir, "skills"), "broski-unified-user-skill", true);

		const skills = await listPiDurableSkills({ cwd, agentDir });

		expect(skills.map((skill) => skill.name).sort()).toEqual([SKILL_NAME, "broski-unified-user-skill"].sort());
		expect(skills.find((skill) => skill.name === SKILL_NAME)).toEqual({
			name: SKILL_NAME,
			description: `${SKILL_NAME} does things`,
			source: "project",
			path: projectSkill,
			autoInvoke: true,
		});
		expect(skills.find((skill) => skill.name === "broski-unified-user-skill")?.source).toBe("user");
		expect(skills.find((skill) => skill.name === "broski-unified-user-skill")?.autoInvoke).toBe(false);
	});
});

describe("unified_list_skills for pi-durable", () => {
	test("replies with the project's skills", async () => {
		const cwd = tempDir("broski-unified-durable-route-");
		writeSkill(join(cwd, ".pi", "skills"), SKILL_NAME);

		const replies = await callUnified({ type: "unified_list_skills", backend: "pi-durable", cwd });

		const reply = replies.find((message) => message.type === "unified_skills");
		expect(reply).toBeDefined();
		if (reply?.type !== "unified_skills") throw new Error("expected unified_skills reply");
		expect(reply.backend).toBe("pi-durable");
		expect(reply.data).toContainEqual({
			name: SKILL_NAME,
			description: `${SKILL_NAME} does things`,
			source: "project",
			path: join(cwd, ".pi", "skills", SKILL_NAME, "SKILL.md"),
			autoInvoke: true,
		});
	});
});

describe("unified_set_model for pi", () => {
	test("replies false when the request carries no model", async () => {
		const replies = await callUnified({ type: "unified_set_model", backend: "pi" });

		const reply = replies.find((message) => message.type === "unified_model_set");
		if (reply?.type !== "unified_model_set") throw new Error("expected unified_model_set reply");
		expect(reply.backend).toBe("pi");
		expect(reply.data).toBe(false);
	});
});

describe("pi skills and model against a live instance", () => {
	test.skipIf(!hasConfiguredProvider)("applies models and thinking levels to the instance for the cwd", async () => {
		const cwd = tempDir("broski-unified-pi-");
		const sessionRoot = tempDir("broski-unified-pi-sessions-");
		writeSkill(join(cwd, ".pi", "skills"), SKILL_NAME);

		const instance = await pi.getOrCreateInstance(cwd, { sessionRoot, noExtensions: true });

		const models = (await pi.listAvailableModels()).filter((model) => configuredProviders.includes(model.provider));
		const model = models.find((entry) => entry.id.includes("haiku")) ?? models[0];
		expect(model).toBeDefined();
		if (!model) return;

		expect(await setPiModel({ model: `${model.provider}/${model.id}`, cwd })).toBe(true);
		expect(instance.session.model?.id).toBe(model.id);

		expect(await setPiModel({ provider: model.provider, modelId: model.id, cwd })).toBe(true);
		expect(instance.session.model?.id).toBe(model.id);

		expect(await setPiModel({ model: `${model.provider}/not-a-real-model`, cwd })).toBe(false);
		expect(await setPiModel({ model: `${model.provider}/${model.id}`, sessionId: "not-the-active-session", cwd })).toBe(
			false,
		);

		expect(await setPiModel({ thinkingLevel: "low", cwd })).toBe(true);
		expect(instance.session.thinkingLevel).toBe("low");
		await expect(setPiModel({ thinkingLevel: "turbo", cwd })).rejects.toThrow("Invalid Pi thinking level");
	});

	test.skipIf(!hasConfiguredProvider)("lists the project's skills for the pi backend", async () => {
		const cwd = tempDir("broski-unified-pi-skills-");
		const sessionRoot = tempDir("broski-unified-pi-skills-sessions-");
		const skillFile = writeSkill(join(cwd, ".pi", "skills"), SKILL_NAME);
		await pi.getOrCreateInstance(cwd, { sessionRoot, noExtensions: true });

		const skills = await listPiSkills(cwd);
		expect(skills).toContainEqual({
			name: SKILL_NAME,
			description: `${SKILL_NAME} does things`,
			source: "project",
			path: skillFile,
			autoInvoke: true,
		});

		const replies = await callUnified({ type: "unified_list_skills", backend: "pi", cwd });
		const reply = replies.find((message) => message.type === "unified_skills");
		if (reply?.type !== "unified_skills") throw new Error("expected unified_skills reply");
		expect(reply.backend).toBe("pi");
		expect(reply.data).toContainEqual({
			name: SKILL_NAME,
			description: `${SKILL_NAME} does things`,
			source: "project",
			path: skillFile,
			autoInvoke: true,
		});
	});
});
