import type { Rejected } from "../contract";
import { rejected } from "./results";

/** Why the path policy refused a path. */
export type SecureRefusal = "invalid" | "outside" | "missing" | "denied" | "loop" | "failed";

/** A path the policy allows, canonical, or why it refuses it: `outside` the bases (or a link leading out of them). */
export type SecurePath = { readonly path: string } | { readonly refused: SecureRefusal };

/** The refusal a phone can show for a path the policy refused: every part of the bridge that asks the policy tells it alike. */
export function pathRefusal(path: string, refused: SecureRefusal): Rejected {
	switch (refused) {
		case "invalid":
			return rejected("invalid_input", `${JSON.stringify(path)} is not a path the bridge can use`);
		case "outside":
			return rejected("forbidden", `${path} is outside the folders this bridge serves`);
		case "missing":
			return rejected("not_found", `${path} does not exist`);
		case "denied":
			return rejected("forbidden", `the system does not let the bridge resolve ${path}`);
		case "loop":
			return rejected("invalid_input", `${path} runs into a symbolic link loop`);
		case "failed":
			return rejected("backend_error", `${path} could not be resolved`);
	}
}
