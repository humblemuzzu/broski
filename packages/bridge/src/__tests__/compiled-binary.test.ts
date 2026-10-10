import { describe, expect, test } from "bun:test";
import { detectCompiledBinary, isBunfsPath, isCompiledBinary } from "../compiled-binary";

describe("isBunfsPath", () => {
	test("matches the macOS/Linux virtual root", () => {
		expect(isBunfsPath("/$bunfs/root/broski-darwin-arm64")).toBe(true);
		expect(isBunfsPath("/$bunfs/root/broski-linux-x64")).toBe(true);
		expect(isBunfsPath("file:///$bunfs/root/broski")).toBe(true);
	});

	test("matches the Windows virtual root", () => {
		expect(isBunfsPath("B:/~BUN/root/broski-windows-x64.exe")).toBe(true);
		expect(isBunfsPath("B:\\~BUN\\root\\broski-windows-x64.exe")).toBe(true);
		expect(isBunfsPath("file:///B:/~BUN/root/broski.exe")).toBe(true);
	});

	test("rejects real filesystem paths", () => {
		expect(isBunfsPath("/Users/me/proj/packages/bridge/src/index.ts")).toBe(false);
		expect(isBunfsPath("C:/Users/me/proj/bin/broski.ts")).toBe(false);
		expect(isBunfsPath("file:///Users/me/proj/bin/broski.ts")).toBe(false);
		expect(isBunfsPath("")).toBe(false);
		expect(isBunfsPath(undefined)).toBe(false);
		expect(isBunfsPath(null)).toBe(false);
	});
});

describe("detectCompiledBinary", () => {
	test("dev: `bun src/index.ts`", () => {
		expect(
			detectCompiledBinary({
				standaloneFlag: false,
				metaUrl: "file:///Users/me/proj/packages/bridge/src/index.ts",
				metaPath: "/Users/me/proj/packages/bridge/src/index.ts",
				bunMain: "/Users/me/proj/packages/bridge/src/index.ts",
				argv1: "/Users/me/proj/packages/bridge/src/index.ts",
				execPath: "/Users/me/.bun/bin/bun",
			}),
		).toBe(false);
	});

	test("dev: `bun bin/broski.ts`", () => {
		expect(
			detectCompiledBinary({
				standaloneFlag: false,
				metaUrl: "file:///Users/me/proj/packages/bridge/bin/broski.ts",
				metaPath: "/Users/me/proj/packages/bridge/bin/broski.ts",
				bunMain: "/Users/me/proj/packages/bridge/bin/broski.ts",
				argv1: "/Users/me/proj/packages/bridge/bin/broski.ts",
				execPath: "/Users/me/.bun/bin/bun",
			}),
		).toBe(false);
	});

	test("dev: bun test runner", () => {
		expect(
			detectCompiledBinary({
				standaloneFlag: false,
				metaUrl: "file:///Users/me/proj/packages/bridge/src/__tests__/compiled-binary.test.ts",
				metaPath: "/Users/me/proj/packages/bridge/src/__tests__/compiled-binary.test.ts",
				bunMain: "/Users/me/proj/packages/bridge/src/__tests__/compiled-binary.test.ts",
				argv1: undefined,
				execPath: "/Users/me/.bun/bin/bun",
			}),
		).toBe(false);
	});

	test("compiled darwin-arm64", () => {
		expect(
			detectCompiledBinary({
				standaloneFlag: true,
				metaUrl: "file:///$bunfs/root/broski-darwin-arm64",
				metaPath: "/$bunfs/root/broski-darwin-arm64",
				bunMain: "/$bunfs/root/broski-darwin-arm64",
				argv1: "/$bunfs/root/broski-darwin-arm64",
				execPath: "/Users/me/dist/broski-darwin-arm64",
			}),
		).toBe(true);
	});

	test("compiled linux-x64", () => {
		expect(
			detectCompiledBinary({
				standaloneFlag: true,
				metaUrl: "file:///$bunfs/root/broski-linux-x64",
				metaPath: "/$bunfs/root/broski-linux-x64",
				bunMain: "/$bunfs/root/broski-linux-x64",
				argv1: "/$bunfs/root/broski-linux-x64",
				execPath: "/home/me/dist/broski-linux-x64",
			}),
		).toBe(true);
	});

	test("compiled windows-x64", () => {
		expect(
			detectCompiledBinary({
				standaloneFlag: true,
				metaUrl: "file:///B:/~BUN/root/broski-windows-x64.exe",
				metaPath: "B:/~BUN/root/broski-windows-x64.exe",
				bunMain: "B:/~BUN/root/broski-windows-x64.exe",
				argv1: "B:/~BUN/root/broski-windows-x64.exe",
				execPath: "C:\\Users\\me\\dist\\broski-windows-x64.exe",
			}),
		).toBe(true);
	});

	test("bunfs fallback when the runtime exposes no standalone flag", () => {
		expect(
			detectCompiledBinary({
				metaUrl: "file:///$bunfs/root/broski-darwin-arm64",
				execPath: "/Users/me/dist/broski-darwin-arm64",
				argv1: "/$bunfs/root/broski-darwin-arm64",
			}),
		).toBe(true);
	});

	test("execPath === argv1 remains a last-resort signal", () => {
		expect(detectCompiledBinary({ execPath: "/usr/local/bin/broski", argv1: "/usr/local/bin/broski" })).toBe(true);
	});

	test("the current test process is not a compiled binary", () => {
		expect(isCompiledBinary()).toBe(false);
	});
});
