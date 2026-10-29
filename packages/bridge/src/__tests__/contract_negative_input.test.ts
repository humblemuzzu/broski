import { describe, test } from "bun:test";
import type { AttachmentKind } from "../contract/content";
import type { MentionKind } from "../contract/input";
import { imagesComeBackByReference, inputReachesTheModel } from "../contract/testing/rules-input";
import { breakBackend, breakControl, breakDriver, breakStream, fails, refused } from "./helpers/broken-adapters";

function stripping(kind: AttachmentKind) {
	return breakControl((control) => ({
		prompt: (input) =>
			control.prompt({ ...input, attachments: input.attachments.filter((item) => item.kind !== kind) }),
	}));
}

function accepting(change: { attachments?: AttachmentKind[]; mentions?: MentionKind[]; commands?: boolean }) {
	return breakBackend((backend) => ({ traits: { ...backend.traits, ...change } }));
}

describe("the input rule fails", () => {
	test("for an image that never reaches the model", () =>
		fails(stripping("image"), inputReachesTheModel, /a image attachment did not reach the model/));

	test("for a file that never reaches the model", () =>
		fails(stripping("file"), inputReachesTheModel, /a file attachment did not reach the model/));

	test("for mentions that never reach the model", () =>
		fails(
			breakControl((control) => ({ prompt: (input) => control.prompt({ ...input, mentions: [] }) })),
			inputReachesTheModel,
			/a file mention did not reach the model/,
		));

	test("for an agent mention that never reaches the model", () =>
		fails(
			breakControl((control) => ({
				prompt: (input) =>
					control.prompt({ ...input, mentions: input.mentions.filter((mention) => mention.kind !== "agent") }),
			})),
			inputReachesTheModel,
			/a agent mention did not reach the model/,
		));

	test("for an agent mention the driver cannot name", () =>
		fails(
			breakDriver(() => ({ agentName: undefined })),
			inputReachesTheModel,
			/driver names no agent/,
		));

	test("for a driver that sees no input", () =>
		fails(
			breakDriver(() => ({ delivered: async () => undefined })),
			inputReachesTheModel,
			/saw no input reach the model/,
		));

	test("for a command sent as plain text", () =>
		fails(
			breakControl((control) => ({
				prompt: ({ command: _command, ...input }) => control.prompt(input),
			})),
			inputReachesTheModel,
			/did not reach the model as a command/,
		));

	test("for a listed command the backend rejects", () =>
		fails(
			breakBackend(() => ({
				listCommands: async () => ({
					status: "accepted",
					commands: [{ id: "/ghost", name: "ghost", kind: "command" }],
				}),
			})),
			inputReachesTheModel,
			/command \/ghost was rejected/,
		));

	test("for listed commands none of which starts a run", () =>
		fails(
			breakBackend(() => ({
				listCommands: async () => ({ status: "accepted", commands: [{ id: "/noop", name: "noop", kind: "command" }] }),
			})),
			inputReachesTheModel,
			/no listed command starts a run/,
		));

	test("for an undeclared attachment kind that is accepted", () =>
		fails(
			accepting({ attachments: ["file"] }),
			inputReachesTheModel,
			/a image attachment is not declared yet accepted/,
		));

	test("for an undeclared file attachment that is accepted", () =>
		fails(
			accepting({ attachments: ["image"] }),
			inputReachesTheModel,
			/a file attachment is not declared yet accepted/,
		));

	test("for an undeclared file mention that is accepted", () =>
		fails(accepting({ mentions: ["agent"] }), inputReachesTheModel, /a file mention is not declared yet accepted/));

	test("for an undeclared mention kind that is accepted", () =>
		fails(accepting({ mentions: ["file"] }), inputReachesTheModel, /a agent mention is not declared yet accepted/));

	test("for commands accepted though undeclared", () =>
		fails(
			breakBackend((backend) => ({
				traits: { ...backend.traits, commands: false },
				listCommands: async () => ({ status: "accepted", commands: [] }),
			})),
			inputReachesTheModel,
			/a command is not declared yet accepted/,
		));
});

describe("the image reference rule fails", () => {
	test("for a live user message without the image", () =>
		fails(
			breakStream((item) =>
				item.event.type === "user_message" ? [{ ...item, event: { ...item.event, attachments: [] } }] : [item],
			),
			imagesComeBackByReference,
			/live user message does not name the image/,
		));

	test("for a prompt with no user message", () =>
		fails(
			breakStream((item) => (item.event.type === "user_message" ? [] : [item])),
			imagesComeBackByReference,
			/the prompt has no user message/,
		));

	test("for an image that cannot be read back", () =>
		fails(
			breakBackend(() => ({ readAttachment: async () => refused })),
			imagesComeBackByReference,
			/reading the image from the live user message was rejected/,
		));

	test("for an image the transcript names but cannot read back", () =>
		fails(
			breakBackend((backend) => {
				let reads = 0;
				return {
					readAttachment: async (session, attachment) =>
						++reads === 1 ? backend.readAttachment(session, attachment) : refused,
				};
			}),
			imagesComeBackByReference,
			/reading the image from the transcript was rejected/,
		));

	test("for an image read back with other bytes", () =>
		fails(
			breakBackend(() => ({
				readAttachment: async () => ({
					status: "accepted",
					image: { kind: "image", mimeType: "image/png", data: "AAAA" },
				}),
			})),
			imagesComeBackByReference,
			/is not the one sent/,
		));

	test("for a prompt missing from the transcript", () =>
		fails(
			breakBackend((backend) => ({
				readTranscript: async (session, page) => {
					const read = await backend.readTranscript(session, page);
					return read.status === "accepted"
						? { ...read, page: { ...read.page, items: read.page.items.filter((item) => item.kind !== "user_message") } }
						: read;
				},
			})),
			imagesComeBackByReference,
			/the prompt is not in the transcript/,
		));

	test("for a transcript without the image", () =>
		fails(
			breakBackend((backend) => ({
				readTranscript: async (session, page) => {
					const read = await backend.readTranscript(session, page);
					return read.status === "accepted"
						? {
								...read,
								page: {
									...read.page,
									items: read.page.items.map((item) =>
										item.kind === "user_message" ? { ...item, attachments: [] } : item,
									),
								},
							}
						: read;
				},
			})),
			imagesComeBackByReference,
			/the transcript does not name the image/,
		));

	test("for an unknown attachment that is not not_found", () =>
		fails(
			breakBackend((backend) => ({
				readAttachment: async (session, attachment) => {
					const read = await backend.readAttachment(session, attachment);
					return read.status === "rejected" ? refused : read;
				},
			})),
			imagesComeBackByReference,
			/unknown attachment must be not_found/,
		));
});
