/** The adapter's two answers to a request: accepted, or `Rejected` with a code and a bounded message. */

import { rejected } from "../../adapter-kit/rejections";
import type { ActionAccepted, Rejected } from "../../contract";

export { rejected } from "../../adapter-kit/rejections";

export const ACCEPTED: ActionAccepted = { status: "accepted" };

/** The answer every control method gives once its session is closed (contract README §5, rule 3). */
export const CLOSED: Rejected = rejected("closed", "the session is closed");
