/** Lane D · D10: a `PromptInput` as the `SDKUserMessage` it is sent as; images base64, mentions as `@` text. */

import type { UUID } from "node:crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { PromptInput, Rejected } from "../../../contract";
import { notBuilt } from "../rejections";

export function userMessageOf(_input: PromptInput, _uuid: UUID): SDKUserMessage | Rejected {
	return notBuilt("lane D: userMessageOf");
}
