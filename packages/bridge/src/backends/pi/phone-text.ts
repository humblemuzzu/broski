/**
 * Text Pi, an extension or a tool wrote, as the phone gets it (`adapter-kit/phone-text.ts`): terminal escapes, C0/C1
 * controls and the bidi direction characters of UAX #9 removed, then bounded.
 */

import { phoneName } from "../../adapter-kit/phone-text";

export { phoneName, phoneText } from "../../adapter-kit/phone-text";

/** A name or description from Pi's configuration or an extension, as one list row shows it. */
export function rowText(text: string | undefined): string {
	return phoneName(text ?? "");
}
