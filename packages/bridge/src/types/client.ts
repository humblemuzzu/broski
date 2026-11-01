import type { CcClientMessage } from "./claude-code-client";
import type { CoreClientMessage } from "./client-core";
import type { UnifiedClientMessage } from "./unified-client";
import type { UsageClientMessage } from "./usage";
import type { WorkspaceClientMessage } from "./workspace-client";

export type ClientMessage =
	| CoreClientMessage
	| WorkspaceClientMessage
	| CcClientMessage
	| UsageClientMessage
	| UnifiedClientMessage;
