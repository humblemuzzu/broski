/**
 * Transcripts in the shape the CLI writes them, built entry by entry with the parent chain and the
 * timestamps filled in, so the store is tested against the SDK's real reader over real-looking files.
 */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertTempClaudePath } from "../../../helpers/claude-home";
import { projectKey } from "../../helpers/fixture-transcripts";

export interface BuiltTranscript {
	readonly sessionId: string;
	readonly path: string;
	readonly cwd: string;
	/** The uuid of each entry written, in order. */
	readonly uuids: string[];
}

type Line = Record<string, unknown>;

export class TranscriptBuilder {
	private readonly lines: Line[] = [];
	private last: string | null = null;
	private clock: number;
	readonly uuids: string[] = [];

	constructor(
		readonly sessionId: string,
		readonly cwd: string,
		startedAt = Date.UTC(2026, 10, 1),
		private readonly extra: Line = {},
	) {
		this.clock = startedAt;
	}

	private push(type: string, body: Line, uuid: string = crypto.randomUUID()): string {
		this.clock += 1000;
		const line: Line = {
			sessionId: this.sessionId,
			cwd: realpathSync(this.cwd),
			version: "2.1.316",
			isSidechain: false,
			userType: "external",
			...this.extra,
			type,
			uuid,
			parentUuid: this.last,
			timestamp: new Date(this.clock).toISOString(),
			...body,
		};
		this.lines.push(line);
		this.last = uuid;
		this.uuids.push(uuid);
		return uuid;
	}

	user(text: string, uuid?: string): string {
		return this.push("user", { message: { role: "user", content: text } }, uuid);
	}

	userBlocks(content: unknown[], uuid?: string): string {
		return this.push("user", { message: { role: "user", content } }, uuid);
	}

	/** One block of an assistant message, as the CLI writes it: an entry per block, sharing `message.id`. */
	assistant(messageId: string, block: unknown): string {
		return this.push("assistant", {
			message: {
				id: messageId,
				type: "message",
				role: "assistant",
				model: "claude-opus-5-5",
				content: [block],
				stop_reason: null,
				usage: { input_tokens: 1, output_tokens: 1 },
			},
		});
	}

	text(messageId: string, text: string): string {
		return this.assistant(messageId, { type: "text", text });
	}

	toolUse(messageId: string, toolUseId: string, name: string, input: unknown): string {
		return this.assistant(messageId, {
			type: "tool_use",
			id: toolUseId,
			name,
			input,
		});
	}

	toolResult(toolUseId: string, content: unknown, toolUseResult?: unknown): string {
		return this.push("user", {
			message: {
				role: "user",
				content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
			},
			...(toolUseResult !== undefined && { toolUseResult }),
		});
	}

	system(subtype: string, body: Line = {}): string {
		return this.push("system", {
			subtype,
			level: "info",
			isMeta: false,
			...body,
		});
	}

	/** A compaction as the CLI writes it: a boundary that starts a new chain, then the summary as a user entry. */
	compaction(summary: string): string {
		const before = this.last;
		this.last = null;
		this.push("system", {
			subtype: "compact_boundary",
			content: "Conversation compacted",
			logicalParentUuid: before,
			compactMetadata: { trigger: "manual", preTokens: 100, postTokens: 10 },
			isMeta: false,
			level: "info",
		});
		return this.push("user", {
			isCompactSummary: true,
			message: { role: "user", content: summary },
		});
	}

	linesText(): string {
		return this.lines.map((line) => JSON.stringify(line)).join("\n");
	}

	write(configDir: string): BuiltTranscript {
		assertTempClaudePath(configDir, "CLAUDE_CONFIG_DIR");
		const dir = join(configDir, "projects", projectKey(this.cwd));
		mkdirSync(dir, { recursive: true });
		const path = join(dir, `${this.sessionId}.jsonl`);
		writeFileSync(path, `${this.lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
		return {
			sessionId: this.sessionId,
			path,
			cwd: realpathSync(this.cwd),
			uuids: [...this.uuids],
		};
	}
}

export interface SubagentSpec {
	readonly agentId: string;
	readonly toolUseId: string;
	readonly agentType?: string;
	readonly description?: string;
	readonly prompts: readonly string[];
}

/** `<project>/<sessionId>/subagents/agent-<id>.jsonl` and its `.meta.json`, beside the parent's transcript. */
export function writeSubagent(parent: BuiltTranscript, spec: SubagentSpec): string {
	const dir = join(parent.path.slice(0, -".jsonl".length), "subagents");
	mkdirSync(dir, { recursive: true });
	const builder = new TranscriptBuilder(parent.sessionId, parent.cwd, undefined, {
		isSidechain: true,
		agentId: spec.agentId,
	});
	for (const prompt of spec.prompts) {
		builder.user(prompt);
		builder.text(`msg_${spec.agentId}_${builder.uuids.length}`, `Done: ${prompt}`);
	}
	const file = join(dir, `agent-${spec.agentId}.jsonl`);
	writeFileSync(file, `${builder.linesText()}\n`);
	writeFileSync(
		join(dir, `agent-${spec.agentId}.meta.json`),
		JSON.stringify({
			agentType: spec.agentType ?? "general-purpose",
			description: spec.description ?? "A subagent",
			toolUseId: spec.toolUseId,
			parentAgentId: null,
			spawnDepth: 1,
		}),
	);
	return file;
}
