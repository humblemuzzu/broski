/** `custom-tools.json` is never replaced by a save when it does not parse, and saves never lose each other. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CustomToolDefinition } from "../custom-tools";
import { createCustomToolStore } from "../custom-tools-store";

let root: string;
let path: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "broski-custom-tools-"));
	path = join(root, "custom-tools.json");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function tool(id: string): CustomToolDefinition {
	return {
		id,
		name: `tool_${id}`,
		description: "d",
		parameters: [],
		handler: "script",
		handlerConfig: { command: "echo" },
		enabled: true,
		createdAt: 0,
		updatedAt: 0,
	};
}

const idsOnDisk = () => JSON.parse(readFileSync(path, "utf8")).tools.map((t: CustomToolDefinition) => t.id);

describe("the custom tools file", () => {
	test("a truncated file refuses a save and a delete, and stays byte for byte", async () => {
		const truncated = '{"version":1,"tools":[{"id":"a","name":"keep_me"},';
		writeFileSync(path, truncated);
		const store = createCustomToolStore(path);
		expect(await store.all()).toEqual([]);
		await expect(store.save(tool("b"))).rejects.toThrow("not strict JSON");
		await expect(store.delete("a")).rejects.toThrow("not strict JSON");
		expect(readFileSync(path, "utf8")).toBe(truncated);
		expect(readdirSync(root)).toEqual(["custom-tools.json"]);
	});

	test("a file whose tools are not a list is refused too", async () => {
		writeFileSync(path, '{"version":1,"tools":{}}');
		await expect(createCustomToolStore(path).save(tool("b"))).rejects.toThrow("not a list");
		expect(readFileSync(path, "utf8")).toBe('{"version":1,"tools":{}}');
	});

	test("saves at once all land, a tool edited by hand meanwhile is kept, and the file keeps its mode", async () => {
		writeFileSync(path, JSON.stringify({ version: 1, tools: [tool("a")] }, null, 2), { mode: 0o640 });
		const store = createCustomToolStore(path);
		await store.all();
		writeFileSync(path, JSON.stringify({ version: 1, tools: [tool("a"), tool("hand")] }, null, 2));
		await Promise.all(["b", "c", "d"].map((id) => store.save(tool(id))));
		expect(idsOnDisk()).toEqual(["a", "hand", "b", "c", "d"]);
		expect(statSync(path).mode & 0o777).toBe(0o640);
		expect(await store.delete("hand")).toBe(true);
		expect(await store.delete("hand")).toBe(false);
		expect(idsOnDisk()).toEqual(["a", "b", "c", "d"]);
		expect((await store.all()).map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
	});

	test("a missing file is created private on the first save; a delete creates nothing", async () => {
		const store = createCustomToolStore(join(root, "nested", "custom-tools.json"));
		expect(await store.delete("x")).toBe(false);
		expect(existsSync(join(root, "nested", "custom-tools.json"))).toBe(false);
		await store.save(tool("a"));
		expect(statSync(join(root, "nested", "custom-tools.json")).mode & 0o777).toBe(0o600);
	});
});
