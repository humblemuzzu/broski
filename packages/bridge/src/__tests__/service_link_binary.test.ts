import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveLinkBinary } from "../platform/service/link-binary";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "broski-link-bin-"));
}

function writeFileAt(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "");
}

describe("broski-link path resolution", () => {
	test("an explicit --link-bin wins", () => {
		const root = tempRoot();
		try {
			writeFileAt(join(root, "bin", "broski-link"));
			writeFileAt(join(root, "elsewhere", "broski-link"));

			const found = resolveLinkBinary({
				broskiBinaryPath: join(root, "bin", "broski"),
				override: join(root, "elsewhere", "broski-link"),
				homeDir: root,
				compiled: true,
			});
			expect(found).toBe(join(root, "elsewhere", "broski-link"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a missing --link-bin is an error naming the path", () => {
		const root = tempRoot();
		try {
			writeFileAt(join(root, "bin", "broski-link"));

			expect(() =>
				resolveLinkBinary({
					broskiBinaryPath: join(root, "bin", "broski"),
					override: join(root, "missing", "broski-link"),
					homeDir: root,
					compiled: true,
				}),
			).toThrow(/broski-link not found at .*missing/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a compiled install finds the sibling binary next to broski", () => {
		const root = tempRoot();
		try {
			writeFileAt(join(root, ".broski", "bin", "broski-link"));

			const found = resolveLinkBinary({
				broskiBinaryPath: join(root, ".broski", "bin", "broski"),
				homeDir: root,
				compiled: true,
				searchRoots: [root],
			});
			expect(found).toBe(join(root, ".broski", "bin", "broski-link"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a dev run walks up from the script to packages/link/target/release", () => {
		const root = tempRoot();
		try {
			writeFileAt(join(root, "packages", "link", "target", "release", "broski-link"));

			const found = resolveLinkBinary({
				broskiBinaryPath: join(root, "packages", "bridge", "src", "index.ts"),
				homeDir: join(root, "empty-home"),
				compiled: false,
				searchRoots: [join(root, "packages", "bridge", "src")],
			});
			expect(found).toBe(join(root, "packages", "link", "target", "release", "broski-link"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("the dev tree is ignored by a compiled binary", () => {
		const root = tempRoot();
		try {
			writeFileAt(join(root, "packages", "link", "target", "release", "broski-link"));

			expect(() =>
				resolveLinkBinary({
					broskiBinaryPath: join(root, "bin", "broski"),
					homeDir: join(root, "empty-home"),
					compiled: true,
					searchRoots: [root],
				}),
			).toThrow(/broski-link not found/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a missing binary lists every candidate and how to build it", () => {
		const root = tempRoot();
		try {
			const broskiBinaryPath = join(root, "bin", "broski");
			writeFileAt(broskiBinaryPath);

			let message = "";
			try {
				resolveLinkBinary({
					broskiBinaryPath,
					homeDir: root,
					compiled: true,
					searchRoots: [root],
				});
			} catch (err) {
				message = err instanceof Error ? err.message : String(err);
			}

			expect(message).toContain(join(root, "bin", "broski-link"));
			expect(message).toContain(join(root, ".broski", "bin", "broski-link"));
			expect(message).toContain("cd packages/link && cargo build --release");
			expect(message).toContain("broski install --link-bin <path>");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
