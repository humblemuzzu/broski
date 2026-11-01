import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { homedir, platform, release } from "node:os";
import { basename, resolve } from "node:path";
import packageMeta from "../package.json";
import type { CliOptions } from "./cli";
import { redactSensitiveText } from "./logging/redact";
import { isCompiledBinary } from "./platform";
import { fileExists } from "./utils/fs-helpers";

export type LogsRunOptions = Pick<
	CliOptions,
	| "logsFollow"
	| "logsJson"
	| "logsPlain"
	| "logsLines"
	| "logsIntervalMs"
	| "logsExport"
	| "logsIncludeErrors"
	| "logsRedact"
>;

type FileCursor = {
	path: string;
	size: number;
};

const LOG_DIR = resolve(homedir(), ".broski", "logs");
const PRIMARY_LOG = resolve(LOG_DIR, "bridge.log");
const ERROR_LOG = resolve(LOG_DIR, "bridge.error.log");
const EXPORT_DIR = resolve(LOG_DIR, "exports");

function formatNow(): string {
	return new Date().toISOString();
}

function compactTimestamp(iso: string): string {
	return iso.replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
}

function defaultOptions(): LogsRunOptions {
	return {
		logsFollow: false,
		logsJson: false,
		logsPlain: false,
		logsLines: 200,
		logsIntervalMs: 1000,
		logsExport: false,
		logsIncludeErrors: true,
		logsRedact: isCompiledBinary(),
	};
}

function mergeOptions(options?: Partial<LogsRunOptions>): LogsRunOptions {
	const defaults = defaultOptions();
	return {
		...defaults,
		...(options ?? {}),
		logsLines: Math.max(1, Number(options?.logsLines ?? defaults.logsLines)),
		logsIntervalMs: Math.max(100, Number(options?.logsIntervalMs ?? defaults.logsIntervalMs)),
	};
}

async function getLogFiles(includeErrors: boolean): Promise<string[]> {
	const files: string[] = [];
	if (await fileExists(PRIMARY_LOG)) files.push(PRIMARY_LOG);
	if (includeErrors && (await fileExists(ERROR_LOG))) files.push(ERROR_LOG);
	return files;
}

async function readTail(path: string, lines: number, maxBytes = 256_000): Promise<{ size: number; lines: string[] }> {
	const fileStat = await stat(path);
	const size = fileStat.size;
	if (size <= 0) return { size: 0, lines: [] };

	const start = Math.max(0, size - maxBytes);
	const fh = await open(path, "r");
	try {
		const length = size - start;
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await fh.read(buffer, 0, length, start);
		let text = buffer.toString("utf8", 0, bytesRead);

		if (start > 0) {
			const prefix = Buffer.alloc(1);
			const { bytesRead: pb } = await fh.read(prefix, 0, 1, start - 1);
			if (pb === 1 && prefix.toString("utf8", 0, 1) !== "\n") {
				const firstNewline = text.indexOf("\n");
				text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
			}
		}

		const split = text
			.split("\n")
			.filter((line, i, arr) => !(i === arr.length - 1 && line === ""))
			.filter((line) => line.trim().length > 0);
		return { size, lines: split.slice(-lines) };
	} finally {
		await fh.close();
	}
}

function renderLine(path: string, line: string, opts: LogsRunOptions): string {
	const value = opts.logsRedact ? redactSensitiveText(line) : line;
	if (opts.logsPlain) return value;
	const source = basename(path);
	return `[${source}] ${value}`;
}

function emitLine(path: string, line: string, opts: LogsRunOptions): void {
	if (opts.logsJson) {
		const payload = {
			type: "log",
			source: basename(path),
			raw: line,
			message: opts.logsRedact ? redactSensitiveText(line) : line,
			time: formatNow(),
		};
		process.stdout.write(`${JSON.stringify(payload)}\n`);
		return;
	}
	process.stdout.write(`${renderLine(path, line, opts)}\n`);
}

function detectLikelyIssues(lines: string[]): string[] {
	const text = lines.join("\n").toLowerCase();
	const issues: string[] = [];

	if (text.includes("eaddrinuse") || (text.includes("port") && text.includes("already in use"))) {
		issues.push("Port conflict detected: another process may already be using the bridge port.");
	}
	if (text.includes("ws rejected")) {
		issues.push("WebSocket connection rejected events found (auth/origin/client-limit).");
	}
	if (text.includes("proxy blocked")) {
		issues.push("Proxy request was blocked by allowlist/security checks.");
	}

	return issues;
}

async function exportDiagnostics(files: string[], opts: LogsRunOptions): Promise<string> {
	await mkdir(EXPORT_DIR, { recursive: true });
	const now = new Date().toISOString();
	const filename = `broski-diagnostics-${compactTimestamp(now)}.txt`;
	const outPath = resolve(EXPORT_DIR, filename);

	const sections: string[] = [];
	const allLines: string[] = [];

	sections.push("Broski Diagnostics Bundle");
	sections.push(`Generated: ${now}`);
	sections.push(`Version: ${packageMeta.version ?? "unknown"}`);
	sections.push(`Platform: ${platform()} ${release()}`);
	sections.push(`Compiled binary: ${isCompiledBinary() ? "yes" : "no"}`);
	sections.push(`Redaction: ${opts.logsRedact ? "enabled" : "disabled"}`);
	sections.push("");

	for (const file of files) {
		sections.push(`===== ${basename(file)} =====`);
		try {
			const tail = await readTail(file, Math.max(opts.logsLines, 300), 512_000);
			if (tail.lines.length === 0) {
				sections.push("(empty)");
			} else {
				for (const line of tail.lines) {
					const output = opts.logsRedact ? redactSensitiveText(line) : line;
					sections.push(output);
					allLines.push(output);
				}
			}
		} catch (err: any) {
			sections.push(`(failed to read: ${err?.message ?? String(err)})`);
		}
		sections.push("");
	}

	const likelyIssues = detectLikelyIssues(allLines);
	sections.push("===== likely-issues =====");
	if (likelyIssues.length === 0) {
		sections.push("- No obvious issues auto-detected from recent logs.");
	} else {
		for (const issue of likelyIssues) sections.push(`- ${issue}`);
	}
	sections.push("");

	sections.push("===== quick-help =====");
	sections.push("- Re-run checks: broski doctor");
	sections.push("- Interactive troubleshooting: broski troubleshoot");
	sections.push("- Live log tail: broski logs --follow");
	sections.push("- Show a new pairing QR: broski-link pair");
	sections.push("- Link and relay status: broski-link status");
	sections.push("");

	await writeFile(outPath, sections.join("\n"), "utf8");
	return outPath;
}

async function pollUpdates(cursors: FileCursor[], opts: LogsRunOptions): Promise<void> {
	for (const cursor of cursors) {
		try {
			const current = await stat(cursor.path);
			if (current.size === cursor.size) continue;

			if (current.size < cursor.size) {
				cursor.size = 0;
				if (!opts.logsJson) process.stdout.write(`[${basename(cursor.path)}] --- log rotated ---\n`);
			}

			const start = cursor.size;
			const fh = await open(cursor.path, "r");
			try {
				const length = Math.max(0, current.size - start);
				if (length <= 0) {
					cursor.size = current.size;
					continue;
				}
				const buffer = Buffer.alloc(length);
				const { bytesRead } = await fh.read(buffer, 0, length, start);
				const text = buffer.toString("utf8", 0, bytesRead);
				const lines = text.split("\n").filter((line) => line.length > 0);
				for (const line of lines) {
					emitLine(cursor.path, line, opts);
				}
				cursor.size = current.size;
			} finally {
				await fh.close();
			}
		} catch {
			// ignore disappearing files during follow
		}
	}
}

export async function exportLogsDiagnosticsBundle(options?: Partial<LogsRunOptions>): Promise<string> {
	const opts = mergeOptions({
		logsFollow: false,
		logsJson: false,
		logsPlain: false,
		logsExport: true,
		...options,
	});
	const files = await getLogFiles(opts.logsIncludeErrors);
	if (files.length === 0) {
		throw new Error(`No logs found in ${LOG_DIR}`);
	}
	return await exportDiagnostics(files, opts);
}

export async function runLogs(options?: Partial<LogsRunOptions>): Promise<void> {
	const opts = mergeOptions(options);
	const files = await getLogFiles(opts.logsIncludeErrors);

	if (files.length === 0) {
		console.log(`No logs found in ${LOG_DIR}`);
		console.log("Run `broski install` for background logs, or start the bridge with `broski`.");
		return;
	}

	if (opts.logsExport) {
		const exportPath = await exportDiagnostics(files, opts);
		console.log(`Diagnostics exported: ${exportPath}`);
		if (!opts.logsFollow) return;
	}

	const cursors: FileCursor[] = [];

	if (!opts.logsJson) {
		console.log(`Broski logs (${files.map((f) => basename(f)).join(", ")})`);
		console.log("=".repeat(64));
	}

	for (const file of files) {
		const tail = await readTail(file, opts.logsLines);
		for (const line of tail.lines) {
			emitLine(file, line, opts);
		}
		cursors.push({ path: file, size: tail.size });
	}

	if (!opts.logsFollow) return;

	if (!opts.logsJson) {
		console.log("");
		console.log(`Following logs (poll ${opts.logsIntervalMs}ms). Press Ctrl+C to stop.`);
	}

	const timer = setInterval(() => {
		void pollUpdates(cursors, opts);
	}, opts.logsIntervalMs);

	await new Promise<void>((resolvePromise) => {
		const onSignal = () => {
			clearInterval(timer);
			if (!opts.logsJson) process.stdout.write("\n");
			resolvePromise();
		};
		process.on("SIGINT", onSignal);
		process.on("SIGTERM", onSignal);
	});
}
