import { readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, InputEventResult } from "@earendil-works/pi-coding-agent";
import { RemoteDialogs } from "./dialogs";
import { type Frame, type Json, MAX_TEXT, read } from "./projection";

const VERSION = "8";
const LINK_VERSION = 1;
const MAX_QUEUED_BYTES = 2 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_INBOUND_BYTES = 8 * 1024 * 1024;
/** A local socket: a failed try costs a file read and a refused connect, so the wait never grows past 5 s. */
const RETRY_MS = [500, 1_000, 2_000, 3_000, 5_000];
const RUNNING_NOTICE = "Broski: the app on your phone is running this session. Don't type here until it is done.";
const TYPED_WHILE_RUNNING =
	"Broski: the app on your phone is running this session. A message sent here now would split it in two.";
const KEEP_TYPED = "Don't send it (it stays in the editor)";
const SEND_TYPED = "Send it anyway";

interface OpenBlock {
	kind: "text" | "thinking";
	text: string;
}

function linkDirectory(): string {
	return process.env.BROSKI_PI_LINK_DIR || join(homedir(), ".broski", "pi-link");
}

export class Link {
	private ctx: ExtensionContext | undefined;
	private socket: Socket | undefined;
	private welcomed = false;
	private stopped = true;
	private attempt = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private inbound = "";
	private queue: string[] = [];
	private queuedBytes = 0;
	private flushing = false;
	/** The socket's buffer is full: nothing is written until it drains. */
	private blocked = false;
	private dirty = false;
	private running = false;
	private runStartedAt: number | undefined;
	/**
	 * The bridge's own `pi` runs this session, as the bridge last said (`welcome`, `hosted`). Kept when the bridge goes:
	 * the bridge's `pi` outlives it.
	 */
	private phoneRunning = false;
	private readonly blocks = new Map<number, OpenBlock>();
	private readonly tools = new Map<string, { name: string; args: Json }>();
	/** The background tasks extensions announced last (`broski:tasks`), which a snapshot carries. */
	private tasks: Json = [];
	readonly dialogs = new RemoteDialogs((event) => this.post(event));

	constructor(private readonly pi: ExtensionAPI) {}

	begin(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui" || ctx.sessionManager.getSessionFile() === undefined) return;
		this.ctx = ctx;
		this.dialogs.watch(ctx.ui);
		this.running = false;
		this.runStartedAt = undefined;
		this.blocks.clear();
		this.tools.clear();
		this.stopped = false;
		this.connect();
	}

	end(reason: string): void {
		this.stopped = true;
		clearTimeout(this.timer);
		const socket = this.socket;
		this.socket = undefined;
		if (socket && this.welcomed) socket.end(`${JSON.stringify({ t: "bye", reason })}\n`);
		else socket?.destroy();
		this.welcomed = false;
		this.queue = [];
	}

	/**
	 * Copies one event's fields into the buffer; never throws, never waits. The run is tracked with no bridge listening
	 * too, so the snapshot a reconnection sends says what is under way.
	 */
	emit(ctx: ExtensionContext, event: Frame): void {
		this.ctx = ctx;
		this.track(event);
		if (this.socket) this.send({ t: "event", event });
	}

	/**
	 * What the user typed here, while the bridge's own `pi` runs the session: it would be a second writer of the file,
	 * whose lines Pi here never reads. The user decides; kept, the text goes back into the editor.
	 */
	async typed(ctx: ExtensionContext, text: string): Promise<InputEventResult> {
		if (!this.phoneRunning || ctx.mode !== "tui") return { action: "continue" };
		const choice = await this.dialogs.askHere(ctx.ui, TYPED_WHILE_RUNNING, [KEEP_TYPED, SEND_TYPED]);
		if (choice === SEND_TYPED) return { action: "continue" };
		ctx.ui.setEditorText(text);
		return { action: "handled" };
	}

	/** An extension announced its background tasks on Pi's event bus. */
	tasksChanged(tasks: Json): void {
		this.tasks = tasks;
		this.post({ e: "tasks", tasks });
	}

	/** An event that is no run's: nothing to track, and dropped while no bridge listens (a snapshot carries it). */
	private post(event: Frame): void {
		if (this.socket) this.send({ t: "event", event });
	}

	private track(event: Frame): void {
		switch (event.e) {
			case "agent_start":
				this.running = true;
				this.runStartedAt ??= Date.now();
				return;
			case "agent_settled":
				this.running = false;
				this.runStartedAt = undefined;
				this.blocks.clear();
				this.tools.clear();
				return;
			case "message_start":
				this.blocks.clear();
				return;
			case "tool_start":
				this.tools.set(String(event.toolCallId), { name: String(event.toolName), args: event.args ?? null });
				return;
			case "tool_end":
				this.tools.delete(String(event.toolCallId));
				return;
			case "stream":
				if (typeof event.ev === "object" && event.ev !== null && !Array.isArray(event.ev)) this.trackStream(event.ev);
		}
	}

	private trackStream(stream: Frame): void {
		const index = Number(stream.contentIndex);
		switch (stream.type) {
			case "text_start":
			case "thinking_start":
				this.blocks.set(index, { kind: stream.type === "text_start" ? "text" : "thinking", text: "" });
				return;
			case "text_delta":
			case "thinking_delta": {
				const block = this.blocks.get(index);
				if (!block) return;
				block.text += String(stream.delta);
				if (block.text.length > 2 * MAX_TEXT) block.text = block.text.slice(-MAX_TEXT);
				return;
			}
			case "text_end":
			case "thinking_end":
				this.blocks.delete(index);
		}
	}

	private send(frame: Frame): void {
		const line = `${JSON.stringify(frame)}\n`;
		if (line.length > MAX_LINE_BYTES) {
			this.dirty = true;
			return;
		}
		this.queue.push(line);
		this.queuedBytes += line.length;
		if (this.queuedBytes > MAX_QUEUED_BYTES) {
			this.queue = [];
			this.queuedBytes = 0;
			this.dirty = true;
		}
		if (!this.flushing) {
			this.flushing = true;
			setImmediate(() => this.flush());
		}
	}

	private flush(): void {
		this.flushing = false;
		const socket = this.socket;
		if (!socket || !this.welcomed || this.blocked) return;
		if (this.dirty) {
			this.dirty = false;
			this.queue = [`${JSON.stringify({ t: "snapshot", reason: "resync", state: this.state() })}\n`];
		}
		if (this.queue.length === 0) return;
		const data = this.queue.join("");
		this.queue = [];
		this.queuedBytes = 0;
		this.blocked = !socket.write(data);
	}

	private state(): Frame {
		const ctx = this.ctx;
		const model = ctx?.model;
		const running = this.running && ctx?.isIdle() === false;
		return {
			running,
			...(running && this.runStartedAt !== undefined && { runStartedAt: this.runStartedAt }),
			leafId: ctx?.sessionManager.getLeafId() ?? null,
			...(model && { model: { provider: model.provider, id: model.id, images: model.input.includes("image") } }),
			thinking: this.pi.getThinkingLevel(),
			blocks: [...this.blocks].map(([index, block]) => ({ index, kind: block.kind, text: block.text })),
			tools: [...this.tools].map(([id, tool]) => ({ id, name: tool.name, args: tool.args })),
			tasks: this.tasks,
			dialogs: this.dialogs.list(),
		};
	}

	private connect(): void {
		if (this.stopped || this.socket) return;
		const directory = linkDirectory();
		let key: string;
		try {
			key = readFileSync(join(directory, "bridge.key"), "utf8").trim();
		} catch {
			this.retryLater();
			return;
		}
		const socket = createConnection(join(directory, "bridge.sock"));
		socket.unref();
		socket.setEncoding("utf8");
		this.socket = socket;
		this.welcomed = false;
		this.blocked = false;
		this.inbound = "";
		socket.on("error", () => undefined);
		socket.on("close", () => this.closed(socket));
		socket.on("data", (chunk: string) => this.receive(socket, chunk));
		socket.on("drain", () => {
			this.blocked = false;
			this.flush();
		});
		socket.on("connect", () => {
			const ctx = this.ctx;
			if (!ctx) return;
			const hello = {
				t: "hello",
				v: LINK_VERSION,
				key,
				pid: process.pid,
				extension: VERSION,
				session: {
					file: ctx.sessionManager.getSessionFile() ?? "",
					id: ctx.sessionManager.getSessionId(),
					cwd: ctx.cwd,
				},
			};
			socket.write(`${JSON.stringify(hello)}\n`);
		});
	}

	private closed(socket: Socket): void {
		if (this.socket !== socket) return;
		this.socket = undefined;
		this.welcomed = false;
		this.queue = [];
		this.queuedBytes = 0;
		this.retryLater();
	}

	private retryLater(): void {
		if (this.stopped) return;
		const wait = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)] ?? 5_000;
		this.timer = setTimeout(() => this.connect(), wait);
		this.timer.unref();
	}

	private receive(socket: Socket, chunk: string): void {
		this.inbound += chunk;
		if (this.inbound.length > MAX_INBOUND_BYTES) {
			socket.destroy();
			return;
		}
		for (let end = this.inbound.indexOf("\n"); end !== -1; end = this.inbound.indexOf("\n")) {
			const line = this.inbound.slice(0, end);
			this.inbound = this.inbound.slice(end + 1);
			try {
				this.handle(socket, JSON.parse(line));
			} catch {
				socket.destroy();
				return;
			}
		}
	}

	private handle(socket: Socket, frame: unknown): void {
		const type = read(frame, "t");
		if (type === "welcome" && !this.welcomed) {
			this.welcomed = true;
			this.attempt = 0;
			this.queue = [`${JSON.stringify({ t: "snapshot", reason: "connect", state: this.state() })}\n`];
			this.queuedBytes = 0;
			this.dirty = false;
			this.flush();
			this.phoneRunning = read(frame, "running") === true;
			if (this.phoneRunning) this.ctx?.ui.notify(RUNNING_NOTICE, "warning");
		} else if (type === "hosted" && this.welcomed && this.socket === socket) {
			this.phoneRunning = read(frame, "running") === true;
		} else if (type === "command" && this.welcomed && this.socket === socket) {
			const id = String(read(frame, "id"));
			this.send({ t: "result", id, answer: this.run(read(frame, "command")) });
		}
	}

	/** Prompt, abort and an answer, through the terminal's own session, which is the only writer of its file. */
	private run(command: unknown): Frame {
		const ctx = this.ctx;
		if (!ctx) return { ok: false, code: "backend_error", message: "The terminal's session has ended." };
		try {
			const kind = read(command, "kind");
			if (kind === "answer") return this.answer(command);
			return kind === "abort" ? this.abort(ctx) : this.prompt(ctx, command);
		} catch (error) {
			return { ok: false, code: "backend_error", message: `The terminal refused it: ${String(error)}` };
		}
	}

	private answer(command: unknown): Frame {
		const answered = this.dialogs.answer(String(read(command, "id")), read(command, "reply"));
		return answered
			? { ok: true, disposition: "answered" }
			: { ok: false, code: "invalid_input", message: "That question was answered in the terminal." };
	}

	private abort(ctx: ExtensionContext): Frame {
		if (!ctx.isIdle()) ctx.abort();
		return { ok: true, disposition: "stopped" };
	}

	private prompt(ctx: ExtensionContext, command: unknown): Frame {
		const model = ctx.model;
		if (!model) return { ok: false, code: "no_model", message: "The terminal has no model selected." };
		const images = read(command, "images");
		if (Array.isArray(images) && images.length > 0 && !model.input.includes("image")) {
			return { ok: false, code: "invalid_input", message: `${model.id} takes no images.` };
		}
		const idle = ctx.isIdle();
		if (!idle && !this.running) return { ok: false, code: "busy", message: "The terminal is compacting its context." };
		const mode = read(command, "mode");
		if (!idle && mode === "start") return { ok: false, code: "busy", message: "A run is under way in the terminal." };
		const text = String(read(command, "text") ?? "");
		const content =
			Array.isArray(images) && images.length > 0
				? [
						{ type: "text" as const, text },
						...images.map((image) => ({
							type: "image" as const,
							data: String(read(image, "data")),
							mimeType: String(read(image, "mimeType")),
						})),
					]
				: text;
		const deliverAs = mode === "steer" ? "steer" : "followUp";
		this.pi.sendUserMessage(content, { deliverAs, expandPromptTemplates: read(command, "expand") === true });
		return { ok: true, disposition: idle ? "started" : mode === "steer" ? "steered" : "queued" };
	}
}
