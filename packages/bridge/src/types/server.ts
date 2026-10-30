import type { CcServerMessage } from "./claude-code-server";
import type { CxServerMessage } from "./codex-server";
import type { OcServerMessage } from "./opencode-server";
import type { OcServerOpsMessage } from "./opencode-server-ops";
import type { RuntimeServerMessage } from "./runtime-messages";
import type { CoreServerMessage } from "./server-core";
import type { UnifiedServerMessage } from "./unified-server";
import type { UsageServerMessage } from "./usage";

export type ServerMessage =
	| CoreServerMessage
	| OcServerMessage
	| OcServerOpsMessage
	| CcServerMessage
	| CxServerMessage
	| RuntimeServerMessage
	| UsageServerMessage
	| UnifiedServerMessage;
