/** Lane F's test world: real files in a temp config dir and project, fakes for everything the ops reach through ports. */

import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Query, ResolvedSettings, SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeCodeParts } from "../../../backends/claude-code/backend";
import { callOp } from "../../../backends/claude-code/call-op";
import { CatalogFeed } from "../../../backends/claude-code/catalog-feed";
import type {
	CatalogueAccess,
	CustomToolsPort,
	HostView,
	LiveSessions,
	Ownership,
	SessionStore,
	TerminalWatch,
} from "../../../backends/claude-code/ports";
import { rejected } from "../../../backends/claude-code/rejections";
import { createClaudeCodeServices } from "../../../backends/claude-code/services";
import type { BackendCallResult, CatalogEvent, ClaudeCodeOp, Rejected, SessionId } from "../../../contract";
import { fakeClaudeSdk } from "../helpers/fake-claude-sdk";
import { FakeQuery } from "../helpers/fake-query";

export const NO_RESOLVED: ResolvedSettings = { effective: {}, provenance: {}, sources: [] };

export interface HostSpec {
	readonly query: FakeQuery;
	readonly tasks?: HostView["tasks"];
	readonly busy?: boolean;
	readonly cwd?: string;
}

export interface WorldOptions {
	/** A canned `resolveSettings` answer through the fake SDK; without it the SDK's own reader runs in a worker. */
	readonly resolved?: ResolvedSettings;
	readonly hosts?: Record<SessionId, HostSpec | "idle">;
	readonly init?: Partial<SDKControlInitializeResponse>;
	readonly customTools?: CustomToolsPort;
	readonly env?: Record<string, string>;
	readonly transcript?: SessionStore["transcript"];
	readonly entryOf?: SessionStore["entryOf"];
}

export interface OpsWorld {
	readonly root: string;
	readonly configDir: string;
	readonly cwd: string;
	readonly deps: ClaudeCodeParts;
	readonly events: CatalogEvent[];
	readonly invalidated: (string | undefined)[];
	readonly transient: FakeQuery[];
	call(op: ClaudeCodeOp): Promise<BackendCallResult>;
	write(path: string, text: string): string;
	/** Names of the files the fake `trash` command was given; the real Trash is never reachable from a test world. */
	trashed(): string[];
	cleanup(): Promise<void>;
}

function installFakeTrash(root: string): { bin: string; bucket: string } {
	const bin = join(root, "fake-bin");
	const bucket = join(root, "trashed");
	mkdirSync(bin);
	mkdirSync(bucket);
	writeFileSync(join(bin, "trash"), `#!/bin/sh\nexec /bin/mv "$1" '${bucket}/'\n`);
	chmodSync(join(bin, "trash"), 0o755);
	return { bin, bucket };
}

const NEVER: Rejected = rejected("unsupported", "not part of lane F's world");

const UNUSED_OWNERSHIP: Ownership = {
	load: async () => undefined,
	origin: () => "external",
	claim: async () => undefined,
	notePrompt: async () => undefined,
	prompt: () => undefined,
};

const UNUSED_TERMINAL: TerminalWatch = {
	writing: async () => false,
	openWatchOnly: async () => NEVER,
	start: async () => undefined,
	dispose: async () => undefined,
};

function unusedStore(options: WorldOptions): SessionStore {
	const refuse = async () => NEVER;
	return {
		list: async () => NEVER,
		get: async () => NEVER,
		transcript: options.transcript ?? (async () => NEVER),
		attachment: async () => NEVER,
		locate: async (sessionId) => rejected("not_found", `no session ${sessionId}`),
		lastChainUuid: refuse,
		entryOf: options.entryOf ?? refuse,
		rename: refuse,
		fork: refuse,
		remove: refuse,
		announce: async () => undefined,
		invalidate: () => undefined,
		dispose: () => undefined,
	};
}

function liveWith(options: WorldOptions, transient: FakeQuery[], cwd: string): LiveSessions {
	const hosts = options.hosts ?? {};
	const view = (sessionId: SessionId, spec: HostSpec): HostView => ({
		sessionId,
		cwd: spec.cwd ?? cwd,
		query: spec.query as Query,
		tasks: spec.tasks ?? (() => []),
		busy: () => spec.busy ?? false,
	});
	return {
		row: () => undefined,
		open: async () => NEVER,
		openChild: async () => NEVER,
		isHosted: (sessionId) => typeof hosts[sessionId] === "object",
		withLiveHost: async (sessionId, work) => {
			const spec = hosts[sessionId];
			if (spec === undefined) return rejected("not_found", `no session ${sessionId}`);
			return work(spec === "idle" ? undefined : view(sessionId, spec));
		},
		withHost: async (sessionId, work) => {
			const spec = hosts[sessionId];
			if (spec === undefined) return rejected("not_found", `no session ${sessionId}`);
			if (spec !== "idle") return work(view(sessionId, spec));
			const query = new FakeQuery();
			transient.push(query);
			return work(view(sessionId, { query }));
		},
		end: async () => undefined,
		dispose: async () => undefined,
	};
}

export function opsWorld(options: WorldOptions = {}): OpsWorld {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "broski-ops-")));
	const trash = installFakeTrash(root);
	const configDir = join(root, "home", ".claude");
	const cwd = join(root, "project");
	mkdirSync(configDir, { recursive: true });
	mkdirSync(cwd, { recursive: true });
	const events: CatalogEvent[] = [];
	const invalidated: (string | undefined)[] = [];
	const transient: FakeQuery[] = [];
	const sdk = fakeClaudeSdk({
		configRoot: configDir,
		overrides: { resolveSettings: async () => options.resolved ?? NO_RESOLVED },
	});
	const services = createClaudeCodeServices({
		cli: { found: false, reason: "not needed" },
		env: { HOME: join(root, "home"), PATH: `${trash.bin}:/usr/bin:/bin`, ...options.env },
		stateDir: join(root, "state"),
		clientApp: "broski/test",
		configDir,
		sdk: options.resolved === undefined ? undefined : sdk,
		customTools: options.customTools,
	});
	const init = {
		commands: [],
		agents: [],
		output_style: "default",
		available_output_styles: ["default", "Concise"],
		models: [],
		account: { email: "me@example.test", apiProvider: "firstParty" },
		...options.init,
	} satisfies SDKControlInitializeResponse;
	const catalogue: CatalogueAccess = {
		initialize: async () => init,
		observe: () => undefined,
		invalidate: (cwdArg) => void invalidated.push(cwdArg),
		models: async () => NEVER,
		commands: async () => NEVER,
		modes: async () => NEVER,
		model: async () => undefined,
		listedModelId: async () => undefined,
		status: async () => ({ installed: false, auth: "unknown", usable: false, issues: [] }),
	};
	const deps: ClaudeCodeParts = {
		services,
		catalog: new CatalogFeed({ emit: (event) => events.push(event) }),
		ownership: UNUSED_OWNERSHIP,
		terminal: UNUSED_TERMINAL,
		store: unusedStore(options),
		live: liveWith(options, transient, cwd),
		catalogue,
	};
	return {
		root,
		configDir,
		cwd,
		deps,
		events,
		invalidated,
		transient,
		call: (op) => callOp(deps, { backend: "claude-code", op }),
		write: (path, text) => {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, text);
			return path;
		},
		trashed: () => readdirSync(trash.bucket),
		cleanup: async () => {
			await deps.services.sdk.dispose();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
