/** Lane F · `mcpServers`: live MCP status; enable/disable writes `~/.claude.json` and calls `toggleMcpServer`; reconnect (D22). */

import type { BackendCallResult, McpServersOp } from "../../../contract";
import type { OpsDeps } from "../ports/deps";
import { notBuilt } from "../rejections";

export async function mcpServers(_deps: OpsDeps, _op: McpServersOp): Promise<BackendCallResult> {
	return notBuilt("lane F: mcpServers");
}
