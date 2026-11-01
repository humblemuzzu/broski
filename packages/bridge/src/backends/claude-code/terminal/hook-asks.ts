/** Lane G · D26, blocked (STEP-3 §9): a terminal's `PermissionRequest` hook raised as an ask on its session. */

import type { TerminalAskHandler } from "../ports/terminal";

export const declineTerminalAsk: TerminalAskHandler = async () => undefined;
