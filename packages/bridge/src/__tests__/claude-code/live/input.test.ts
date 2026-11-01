/** D9, D10, D37, D38 (rules 13 and 14): what a prompt is sent as, on the wire and against the real CLI's transcript. */

import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { sendUuid } from "../../../backends/claude-code/ids";
import { userMessageOf, withPriority } from "../../../backends/claude-code/live/input";
import type { PromptInput } from "../../../contract";
import type { ScriptedRequest } from "../../helpers/scripted-anthropic-server";
import { deliveredInput } from "../conformance/delivered";
import { withConfigDir } from "../spike/rig/config-env";
import { expectNoOrphans } from "../spike/rig/orphans";
import { realRig } from "./helpers/rig";

expectNoOrphans();

const CLI_TEST_MS = 30_000;
const PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** 2.1.316 puts an `# Environment` message with role "system" after the first user message; the driver reads the last message. */
function withoutSystemMessages(request: ScriptedRequest): ScriptedRequest {
	const body = request.body as { messages: { role: string }[] };
	return { ...request, body: { ...body, messages: body.messages.filter((message) => message.role === "user") } };
}

function uuidOf(request: PromptInput) {
	const uuid = sendUuid(request.clientRequestId);
	if (uuid === undefined) throw new Error("the test's clientRequestId is not a UUID");
	return uuid;
}

function input(extra: Partial<PromptInput> = {}): PromptInput {
	return {
		clientRequestId: crypto.randomUUID(),
		mode: "start",
		text: "Look at this.",
		attachments: [],
		mentions: [],
		...extra,
	};
}

describe("a prompt as the message it is sent as", () => {
	test("is human-stamped, keyed by its clientRequestId, and carries its priority", () => {
		const request = input();
		const plain = userMessageOf(request, uuidOf(request));
		if ("status" in plain) throw new Error("rejected");
		expect(plain.message.priority).toBeUndefined();
		const prepared = withPriority(plain, "next");
		expect(prepared.message).toEqual({
			type: "user",
			message: { role: "user", content: "Look at this." },
			parent_tool_use_id: null,
			origin: { kind: "human" },
			uuid: uuidOf(request),
			priority: "next",
		});
		expect(prepared.event).toEqual({
			type: "user_message",
			messageId: request.clientRequestId,
			text: "Look at this.",
			attachments: [],
			clientRequestId: request.clientRequestId,
		});
	});

	test("mentions become text, a command becomes a slash command, images become base64 blocks after the text", () => {
		const request = input({
			text: "now",
			command: "review",
			mentions: [
				{ kind: "file", path: "/repo/a.ts" },
				{ kind: "file", path: "/repo/with space.ts" },
				{ kind: "agent", name: "general-purpose" },
			],
			attachments: [{ kind: "image", mimeType: "image/png", data: PIXEL, name: "p.png" }],
		});
		const uuid = uuidOf(request);
		const prepared = userMessageOf(request, uuid);
		if ("status" in prepared) throw new Error("rejected");
		const text = '/review now\n@/repo/a.ts @"/repo/with space.ts" @agent-general-purpose';
		expect(prepared.sentText).toBe(text);
		expect(prepared.typedText).toBe("/review now");
		expect(prepared.message.message.content).toEqual([
			{ type: "text", text },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: PIXEL } },
		]);
		expect(prepared.event.attachments).toEqual([
			{ kind: "image_ref", id: `${uuid}:1`, mimeType: "image/png", name: "p.png" },
		]);
		expect(prepared.imageNames).toEqual(["p.png"]);
	});

	test("an image alone is the first block, and nothing at all is refused", () => {
		const request = input({ text: "", attachments: [{ kind: "image", mimeType: "image/jpeg", data: PIXEL }] });
		const uuid = uuidOf(request);
		const prepared = userMessageOf(request, uuid);
		if ("status" in prepared) throw new Error("rejected");
		expect(prepared.event.attachments).toEqual([{ kind: "image_ref", id: `${uuid}:0`, mimeType: "image/jpeg" }]);
		expect(userMessageOf(input({ text: "  " }), uuid)).toMatchObject({
			status: "rejected",
			rejection: { code: "invalid_input" },
		});
	});

	test("a file attachment is unsupported and an image type the API does not read is invalid_input; nothing is dropped", () => {
		const uuid = crypto.randomUUID();
		const file = userMessageOf(input({ attachments: [{ kind: "file", uri: "/x.txt" }] }), uuid);
		expect(file).toMatchObject({ status: "rejected", rejection: { code: "unsupported" } });
		const tiff = userMessageOf(input({ attachments: [{ kind: "image", mimeType: "image/tiff", data: PIXEL }] }), uuid);
		expect(tiff).toMatchObject({ status: "rejected", rejection: { code: "invalid_input" } });
	});
});

describe("input on the real CLI", () => {
	test(
		"an image reaches the model, is stored at the block the live ref names, and its name is journalled",
		async () => {
			const rig = realRig([{ text: ["I see a pixel."] }]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				const request = input({
					attachments: [{ kind: "image", mimeType: "image/png", data: PIXEL, name: "pixel.png" }],
				});
				await live.runInput(request);
				const sent = JSON.stringify(rig.server.mainRequests()[0]?.body);
				expect(sent).toContain(PIXEL);
				const shown = live.events().find((event) => event.type === "user_message");
				if (shown?.type !== "user_message") throw new Error("no user message");
				const ref = shown.attachments[0];
				expect(ref).toEqual({
					kind: "image_ref",
					id: `${request.clientRequestId}:1`,
					mimeType: "image/png",
					name: "pixel.png",
				});
				const chain = await withConfigDir(rig.home, () =>
					getSessionMessages(live.ref.sessionId, { dir: rig.home.projectDir }),
				);
				const stored = chain[0]?.message as { content: { type: string; source?: { data: string } }[] };
				expect(chain[0]?.uuid).toBe(request.clientRequestId);
				expect(stored.content[1]?.type).toBe("image");
				expect(stored.content[1]?.source?.data).toBe(PIXEL);
				expect(rig.ownership.prompts[0]?.record.imageNames).toEqual(["pixel.png"]);
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a file mention attaches the file, quoted when its path has a space; an agent mention asks for the agent",
		async () => {
			const rig = realRig([{ text: ["ok"] }, { text: ["ok"] }, { text: ["ok"] }]);
			try {
				mkdirSync(join(rig.home.projectDir, "notes dir"), { recursive: true });
				writeFileSync(join(rig.home.projectDir, "notes dir", "my notes.md"), "The secret word is GLORP.\n");
				const live = await rig.openNew(rig.home.projectDir);
				await live.runInput(input({ mentions: [{ kind: "file", path: join(rig.home.projectDir, "README.md") }] }));
				expect(JSON.stringify(rig.server.mainRequests()[0]?.body)).toContain("PLUMBUS");
				await live.runInput(
					input({ mentions: [{ kind: "file", path: join(rig.home.projectDir, "notes dir", "my notes.md") }] }),
				);
				expect(JSON.stringify(rig.server.mainRequests()[1]?.body)).toContain("GLORP");
				await live.runInput(input({ mentions: [{ kind: "agent", name: "general-purpose" }] }));
				expect(JSON.stringify(rig.server.mainRequests()[2]?.body)).toContain('invoke the agent \\"general-purpose\\"');
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a command runs as that command",
		async () => {
			const rig = realRig([{ text: ["ok"] }]);
			try {
				mkdirSync(join(rig.home.projectDir, ".claude", "commands"), { recursive: true });
				writeFileSync(join(rig.home.projectDir, ".claude", "commands", "greet.md"), "Say hello to $ARGUMENTS.\n");
				const live = await rig.openNew(rig.home.projectDir);
				await live.runInput(input({ text: "the moon", command: "greet" }));
				const sent = JSON.stringify(rig.server.mainRequests()[0]?.body);
				expect(sent).toContain("<command-name>/greet</command-name>");
				expect(sent).toContain("Say hello to the moon.");
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"a rejected input starts no run and is not remembered",
		async () => {
			const rig = realRig([]);
			try {
				const live = await rig.openNew(rig.home.projectDir);
				const file = input({ attachments: [{ kind: "file", uri: "/x.txt" }] });
				expect(await live.control.prompt(file)).toMatchObject({
					status: "rejected",
					rejection: { code: "unsupported" },
				});
				expect(live.events()).toEqual([]);
				const again = await live.control.prompt({ ...file, attachments: [] });
				expect(again).toMatchObject({ status: "accepted", disposition: "started" });
				await live.waitFor("run_finished");
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);

	test(
		"what the conformance driver reads back from the request is what was sent: image, file, agent, command",
		async () => {
			const rig = realRig([{ text: ["ok"] }, { text: ["ok"] }, { text: ["ok"] }, { text: ["ok"] }]);
			try {
				mkdirSync(join(rig.home.projectDir, ".claude", "commands"), { recursive: true });
				writeFileSync(join(rig.home.projectDir, ".claude", "commands", "greet.md"), "Say hello to $ARGUMENTS.\n");
				const live = await rig.openNew(rig.home.projectDir);
				const noTranscript = {
					readTranscript: async () => ({
						status: "rejected" as const,
						rejection: { code: "not_found" as const, message: "" },
					}),
				};
				const read = async () => {
					const request = rig.server.mainRequests().at(-1);
					return deliveredInput(noTranscript, request && withoutSystemMessages(request), live.ref);
				};

				const image = { kind: "image" as const, mimeType: "image/png", data: PIXEL };
				await live.runInput(input({ attachments: [image] }));
				expect((await read())?.attachments).toEqual([image]);

				const file = { kind: "file" as const, path: join(rig.home.projectDir, "README.md") };
				await live.runInput(input({ mentions: [file] }));
				expect((await read())?.mentions).toEqual([file]);

				const agent = { kind: "agent" as const, name: "general-purpose" };
				await live.runInput(input({ mentions: [agent] }));
				expect((await read())?.mentions).toEqual([agent]);

				await live.runInput(input({ text: "the moon", command: "greet" }));
				expect((await read())?.command).toBe("greet");
			} finally {
				await rig.dispose();
			}
		},
		CLI_TEST_MS,
	);
});
