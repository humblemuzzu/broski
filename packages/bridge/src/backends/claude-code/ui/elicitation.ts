/** MCP elicitation (D13): a flat form → `form`, an empty schema → `confirm`, a link → `external_url`. */

import type { ElicitationRequest, ElicitationResult } from "@anthropic-ai/claude-agent-sdk";
import {
	type InteractionReply,
	type InteractionRequest,
	MAX_NAME_CHARS,
	MAX_PATH_CHARS,
	MAX_TEXT_CHARS,
} from "../../../contract";
import { clip, nameOr } from "../bounds";
import { phoneText } from "../phone-text";
import { formContent, formPlan } from "./elicitation-form";
import { isValidAsk } from "./probe";
import { reportAskProblem } from "./problems";

export interface ElicitationAsk {
	readonly title: string;
	readonly body?: string;
	readonly request: InteractionRequest;
	readonly resultFor: (reply: InteractionReply) => ElicitationResult | undefined;
}

/** A person dismissed the request, or the CLI no longer waits for it: the server is told it was cancelled. */
export const ELICITATION_CANCELLED: ElicitationResult = { action: "cancel" };

export function elicitationAsk(request: ElicitationRequest): ElicitationAsk {
	const server = phoneText(request.serverName, MAX_NAME_CHARS);
	const message = phoneText(request.message, MAX_TEXT_CHARS);
	const title = nameOr(phoneText(request.title ?? "", MAX_NAME_CHARS), nameOr(message, `${server} asks for input`));
	const subtitle = phoneText(request.description ?? "", MAX_TEXT_CHARS).trim();
	const body = clip([subtitle, message].filter((part) => part !== "").join("\n\n"), MAX_TEXT_CHARS);
	const shown = shownAsk(request, server, title, body);
	return shown !== undefined && isValidAsk(shown) ? shown : unrenderable(request, server, title, message);
}

function shownAsk(
	request: ElicitationRequest,
	server: string,
	title: string,
	body: string,
): ElicitationAsk | undefined {
	try {
		const asked = request.mode === "url" ? linkAsk(request, server) : formAsk(request, server);
		return asked && { title, ...(body !== "" && { body }), ...asked };
	} catch (error) {
		reportAskProblem("elicitation request", error);
		return undefined;
	}
}

type Asked = Pick<ElicitationAsk, "request" | "resultFor">;

function linkAsk(request: ElicitationRequest, server: string): Asked | undefined {
	const { url } = request;
	if (url === undefined || url.length > MAX_PATH_CHARS || !isWebUrl(url)) return undefined;
	return {
		request: { kind: "external_url", url, ...(server !== "" && { server }) },
		resultFor: (reply) => (reply.kind === "external_url" ? { action: "accept" } : undefined),
	};
}

function formAsk(request: ElicitationRequest, server: string): Asked | undefined {
	const plan = formPlan(request.requestedSchema);
	if (!plan) return undefined;
	if (plan.fields.length === 0) {
		return {
			request: { kind: "confirm" },
			resultFor: (reply) =>
				reply.kind === "confirm"
					? reply.confirmed
						? { action: "accept", content: {} }
						: { action: "decline" }
					: undefined,
		};
	}
	return {
		request: { kind: "form", fields: plan.fields, ...(server !== "" && { server }) },
		resultFor: (reply) =>
			reply.kind === "form" ? { action: "accept", content: formContent(plan, reply.values) } : undefined,
	};
}

/**
 * A request this app cannot show still goes to a person, who can decline it (confirm) or dismiss it (cancel): the
 * bridge never declines for them.
 */
function unrenderable(request: ElicitationRequest, server: string, title: string, message: string): ElicitationAsk {
	const what = request.mode === "url" ? "a link the app will not open" : "a form with fields the app cannot show";
	const from = server === "" ? "An MCP server" : server;
	const said = message === "" ? "" : `\n\nIt said:\n${clip(message, MAX_TEXT_CHARS - 1_000)}`;
	return {
		title: nameOr(`Cannot show a request: ${title}`, "Cannot show a request"),
		body: clip(
			`${from} asked for ${what}.${said}\n\nConfirm to decline the request; dismiss this card to cancel it. Nothing is answered for you.`,
			MAX_TEXT_CHARS,
		),
		request: { kind: "confirm" },
		resultFor: (reply) => (reply.kind === "confirm" ? { action: reply.confirmed ? "decline" : "cancel" } : undefined),
	};
}

function isWebUrl(url: string): boolean {
	return URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);
}
