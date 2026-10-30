/**
 * The theme a phone-bound `ExtensionUIContext` hands extensions: every token is the terminal default,
 * so `ctx.ui.theme` works without `initTheme()`. It still wraps text in the default-colour SGR codes
 * (`fg` in `\x1b[39m`), so extension text reaches the phone through `withoutTerminalEscapes`.
 */

import { Theme, type ThemeBg, type ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Every foreground token, so the compiler fails here when Pi adds one. `""` is "terminal default"
 * (pi-coding-agent `src/modes/interactive/theme/theme.ts:226-230`).
 */
const FOREGROUND: Record<ThemeColor, string> = {
	accent: "",
	border: "",
	borderAccent: "",
	borderMuted: "",
	success: "",
	error: "",
	warning: "",
	muted: "",
	dim: "",
	text: "",
	thinkingText: "",
	scrollbarTrack: "",
	scrollbarThumb: "",
	searchMatchText: "",
	userMessageText: "",
	customMessageText: "",
	customMessageLabel: "",
	toolTitle: "",
	toolOutput: "",
	mdHeading: "",
	mdLink: "",
	mdLinkUrl: "",
	mdCode: "",
	mdCodeBlock: "",
	mdCodeBlockBorder: "",
	mdQuote: "",
	mdQuoteBorder: "",
	mdHr: "",
	mdListBullet: "",
	toolDiffAdded: "",
	toolDiffRemoved: "",
	toolDiffContext: "",
	syntaxComment: "",
	syntaxKeyword: "",
	syntaxFunction: "",
	syntaxVariable: "",
	syntaxString: "",
	syntaxNumber: "",
	syntaxType: "",
	syntaxOperator: "",
	syntaxPunctuation: "",
	thinkingOff: "",
	thinkingMinimal: "",
	thinkingLow: "",
	thinkingMedium: "",
	thinkingHigh: "",
	thinkingXhigh: "",
	thinkingMax: "",
	bashMode: "",
};

const BACKGROUND: Record<ThemeBg, string> = {
	selectedBg: "",
	searchMatchBg: "",
	userMessageBg: "",
	customMessageBg: "",
	toolPendingBg: "",
	toolSuccessBg: "",
	toolErrorBg: "",
};

export function plainTheme(): Theme {
	return new Theme(FOREGROUND, BACKGROUND, "truecolor", { name: "broski-plain" });
}
