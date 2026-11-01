import type { CcServerMessage } from "./claude-code-server";
import type { RuntimeServerMessage } from "./runtime-messages";
import type { CoreServerMessage } from "./server-core";
import type { UnifiedServerMessage } from "./unified-server";
import type { UsageServerMessage } from "./usage";
import type { WorkspaceServerMessage } from "./workspace-server";

export type ServerMessage =
	| CoreServerMessage
	| WorkspaceServerMessage
	| CcServerMessage
	| RuntimeServerMessage
	| UsageServerMessage
	| UnifiedServerMessage;
