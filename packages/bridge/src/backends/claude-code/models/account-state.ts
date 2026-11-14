/** Whether an `initialize` answer's account can run a prompt (`sdk.d.ts` `AccountInfo`). */

import type { AccountInfo } from "@anthropic-ai/claude-agent-sdk";
import type { AuthState } from "../../../contract";

function named(value: string | undefined): boolean {
	return value !== undefined && value !== "none";
}

/**
 * On `firstParty` the CLI sets `apiKeySource` only when a key resolved, `subscriptionType` or `email` for a claude.ai
 * sign-in, and `tokenSource` to `"none"` when no token is in use; none of them is a signed-out CLI (the
 * real answer of a CLI with no key and an empty home: `{tokenSource: "none", apiProvider: "firstParty"}`). Any other
 * provider authenticates outside Claude Code (AWS credentials, gcloud, a gateway), so its state is not known here.
 */
export function authOf(account: AccountInfo): AuthState {
	if (account.apiProvider !== "firstParty") return "unknown";
	const credential =
		account.email !== undefined ||
		account.subscriptionType !== undefined ||
		named(account.tokenSource) ||
		named(account.apiKeySource);
	return credential ? "signed_in" : "signed_out";
}
