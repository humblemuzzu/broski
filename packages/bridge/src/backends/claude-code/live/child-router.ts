/** Lane D · a subagent's events (`MappedEvent.agentId`) to its open child session (D20). */

import type { MappedEvent } from "../ports/mapping";

export class ChildRouter {
	route(_event: MappedEvent): void {}
}
