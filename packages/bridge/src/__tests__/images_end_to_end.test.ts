import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { LiveImageCache as ClaudeImageCache } from "../backends/claude-code/live/image-cache";
import { JsonlLines } from "../backends/claude-code/terminal/jsonl-lines";
import { TranslatorState } from "../backends/claude-code/terminal/translate-state";
import { userEvents as claudeTerminalUserEvents } from "../backends/claude-code/terminal/translate-user";
import { LiveImageCache as PiImageCache } from "../backends/pi/live/image-cache";
import { extractUserImagePaths } from "../backends/pi/mapping/image-paths";
import { terminalControl } from "../backends/pi/terminal/control";
import { endedMessage } from "../backends/pi/terminal/extension/projection";
import { TerminalFeed } from "../backends/pi/terminal/feed";
import { MAX_IMAGE_CHARS } from "../contract";
import { fitImageBytes } from "../platform/image-fit";
import { readImageFile } from "../workspace/files/image";

const tempDir = mkdtempSync(join(tmpdir(), "broski-img-e2e-"));
afterAll(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

/** Builds a valid uncompressed-style RGB PNG of `width`x`height` with deterministic noise so it won't compress to 0 bytes. */
function makePng(width: number, height: number): Buffer {
	const raw = Buffer.alloc((width * 3 + 1) * height);
	let seed = 0x12345678;
	for (let y = 0; y < height; y += 1) {
		const row = y * (width * 3 + 1);
		raw[row] = 0;
		for (let x = 0; x < width * 3; x += 1) {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			raw[row + 1 + x] = (seed >>> 24) & 0xff;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const idat = deflateSync(raw, { level: 1 });
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", idat),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

function pngChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const name = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
	return Buffer.concat([len, name, data, crc]);
}

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (const byte of buf) {
		c ^= byte;
		for (let bit = 0; bit < 8; bit += 1) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
	}
	return (c ^ 0xffffffff) >>> 0;
}

describe("fs.image and image fitting", () => {
	test("serves a /tmp PNG cleanly in both thumbnail and full variants and refuses non-images", async () => {
		const pngPath = join(tempDir, "shot.png");
		writeFileSync(pngPath, makePng(900, 600));
		const textPath = join(tempDir, "notes.txt");
		writeFileSync(textPath, "plain text");

		const thumb = await readImageFile(pngPath, "thumbnail");
		expect(thumb.status).toBe("accepted");
		if (thumb.status !== "accepted") throw new Error("expected accepted");
		expect(thumb.data.length).toBeLessThan(384 * 1024);
		expect(thumb.width).toBeLessThanOrEqual(512);
		expect(thumb.height).toBeLessThanOrEqual(512);

		const full = await readImageFile(pngPath, "full");
		expect(full.status).toBe("accepted");
		if (full.status !== "accepted") throw new Error("expected accepted");
		expect(full.width).toBe(900);
		expect(full.height).toBe(600);
		expect(full.resized).toBe(false);

		const refused = await readImageFile(textPath, "full");
		expect(refused).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });

		const missing = await readImageFile(join(tempDir, "missing.png"), "full");
		expect(missing).toMatchObject({ status: "rejected", rejection: { code: "not_found" } });
	});

	test("resizes an oversized >3 MiB PNG cleanly to fit within MAX_IMAGE_CHARS", async () => {
		const huge = makePng(1200, 1100);
		expect(huge.byteLength).toBeGreaterThan(3 * 1_048_576);
		const fitted = await fitImageBytes(huge, "full");
		expect(fitted.ok).toBe(true);
		if (!fitted.ok) throw new Error("expected fitted image");
		expect(fitted.resized).toBe(true);
		expect(fitted.data.length).toBeLessThanOrEqual(MAX_IMAGE_CHARS);
		expect(fitted.originalBytes).toBe(huge.byteLength);
	});
});

describe("Pi live & terminal images", () => {
	test("phone-to-terminal images emit live ImageRefs and populate the live cache", async () => {
		const cache = new PiImageCache();
		const feed = new TerminalFeed(
			() => 1_000,
			() => undefined,
			() => undefined,
			tempDir,
		);
		const events: unknown[] = [];
		feed.live.attach({ emit: (record) => events.push(record.event) });
		const control = terminalControl(
			{
				pid: 1,
				sessionPath: join(tempDir, "s.jsonl"),
				sessionId: "pi-term-1",
				feed,
				command: async () => ({ ok: true, disposition: "started" }),
			},
			cache,
		);
		const reqId = crypto.randomUUID();
		const pngB64 = makePng(16, 16).toString("base64");
		const res = await control.prompt({
			clientRequestId: reqId,
			mode: "start",
			text: "check this",
			attachments: [{ kind: "image", mimeType: "image/png", data: pngB64, name: "ui.png" }],
		});
		expect(res).toEqual({ status: "accepted", disposition: "started" });
		feed.event({ e: "message_end", message: { role: "user", text: "check this", timestamp: 2_000 } });

		const user = events.find(
			(ev): ev is { type: "user_message"; attachments: unknown[] } =>
				typeof ev === "object" && ev !== null && "type" in ev && ev.type === "user_message",
		);
		expect(user?.attachments).toEqual([
			{ kind: "image_ref", id: `live:${reqId}:0`, mimeType: "image/png", name: "ui.png" },
		]);
		expect(cache.get("pi-term-1", `live:${reqId}:0`)?.data).toBe(pngB64);
	});

	test("terminal-pasted image blocks and tool results emit ts: ImageRefs live", () => {
		const projectedUser = endedMessage({
			role: "user",
			timestamp: 42_000,
			content: [
				{ type: "text", text: "look" },
				{ type: "image", mimeType: "image/png", data: "AAAA" },
			],
		});
		expect(projectedUser).toEqual({
			role: "user",
			text: "look",
			timestamp: 42_000,
			images: [{ index: 1, mimeType: "image/png" }],
		});

		const feed = new TerminalFeed(
			() => 1_000,
			() => undefined,
			() => undefined,
			tempDir,
		);
		const events: Record<string, unknown>[] = [];
		feed.live.attach({ emit: (record) => events.push(record.event as Record<string, unknown>) });
		feed.event({ e: "agent_start", leafId: null });
		feed.event({
			e: "message_end",
			message: { role: "user", text: "look", timestamp: 42_000, images: [{ index: 1, mimeType: "image/png" }] },
		});
		expect(events.find((e) => e.type === "user_message")).toMatchObject({
			text: "look",
			attachments: [{ kind: "image_ref", id: "ts:42000:1", mimeType: "image/png" }],
		});

		feed.event({ e: "tool_start", toolCallId: "tc1", toolName: "read", args: { path: "/tmp/a.png" } });
		feed.event({
			e: "tool_end",
			toolCallId: "tc1",
			toolName: "read",
			isError: false,
			result: { content: [{ type: "image", mimeType: "image/png", data: "" }] },
		});
		feed.event({
			e: "message_end",
			message: {
				role: "toolResult",
				toolCallId: "tc1",
				toolName: "read",
				isError: false,
				timestamp: 42_500,
				result: { content: [{ type: "image", mimeType: "image/png", data: "" }] },
			},
		});
		expect(events.find((e) => e.type === "tool_finished")).toMatchObject({
			outcome: "completed",
			result: { content: [{ kind: "image_ref", id: "ts:42500:0", mimeType: "image/png" }] },
		});
	});

	test("extracts existing pi-clipboard temp image paths and cleans the temp path from bubble text", () => {
		const clipPath = join(tempDir, "pi-clipboard-12345678-1234-4000-8000-1234567890ab.png");
		writeFileSync(clipPath, makePng(8, 8));
		const extracted = extractUserImagePaths(`${clipPath}\nfix this button`, tempDir);
		expect(extracted.text).toBe("fix this button");
		expect(extracted.files).toEqual([
			{
				kind: "file",
				uri: clipPath,
				mimeType: "image/png",
				name: "pi-clipboard-12345678-1234-4000-8000-1234567890ab.png",
			},
		]);
	});
});

describe("Claude Code live & terminal images", () => {
	test("terminal translator preserves image-only prompts, strips [Image #1], and reads >4 MiB JSONL lines", () => {
		const state = new TranslatorState();
		const uuid = "00000000-0000-4000-8000-0000000000aa";
		const imgBlock = { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } };
		const imageOnly = claudeTerminalUserEvents(state, { message: { content: [imgBlock] } }, uuid);
		expect(imageOnly.find((m) => m.event.type === "user_message")?.event).toMatchObject({
			type: "user_message",
			text: "",
			attachments: [{ kind: "image_ref", id: `${uuid}:0`, mimeType: "image/png" }],
		});

		const withPlaceholder = claudeTerminalUserEvents(
			state,
			{ message: { content: [{ type: "text", text: "[Image #1]\nwhy is this misaligned?" }, imgBlock] } },
			"00000000-0000-4000-8000-0000000000bb",
		);
		expect(withPlaceholder.find((m) => m.event.type === "user_message")?.event).toMatchObject({
			type: "user_message",
			text: "why is this misaligned?",
			attachments: [{ kind: "image_ref", id: "00000000-0000-4000-8000-0000000000bb:1", mimeType: "image/png" }],
		});

		const lines = new JsonlLines();
		const bigLine = `{"big":"${"A".repeat(5 * 1_048_576)}"}\n`;
		expect(lines.push(Buffer.from(bigLine))).toHaveLength(1);
		expect(lines.dropped).toBe(0);
	});

	test("Claude live image cache holds sent images immediately before JSONL flush", () => {
		const cache = new ClaudeImageCache();
		cache.put("sess-1", "uuid-1:1", { mimeType: "image/png", data: "iVBORw0K", name: "shot.png" });
		expect(cache.get("sess-1", "uuid-1:1")).toEqual({
			kind: "image",
			mimeType: "image/png",
			data: "iVBORw0K",
			name: "shot.png",
		});
	});
});
