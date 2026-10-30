import type { CcClientMessage } from "./claude-code-client";
import type { CoreClientMessage } from "./client-core";
import type { CxClientMessage } from "./codex-client";
import type { OcClientMessage } from "./opencode-client";
import type { OcConfigClientMessage } from "./opencode-config-client";
import type { UnifiedClientMessage } from "./unified-client";
import type { UsageClientMessage } from "./usage";

export type ClientMessage =
	| CoreClientMessage
	| OcClientMessage
	| OcConfigClientMessage
	| CcClientMessage
	| CxClientMessage
	| UsageClientMessage
	| UnifiedClientMessage;
