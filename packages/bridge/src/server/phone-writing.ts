/**
 * What the agents the bridge starts are told about where their words are read: Broski draws them on a phone, in a
 * proportional font on a narrow screen, so they are laid out for that. Appended to Claude Code's own prompt
 * (`systemPrompt.append`) and to Pi's (a section the bridge's extension adds, `backends/pi/host/`); the config key
 * `phoneWriting: false` leaves both as they are. It says how to lay an answer out, never what to say: the person's own
 * instructions still decide that, and a format they ask for in the conversation wins.
 *
 * Antigravity gets none: Google's rules for third-party ACP clients forbid a client that adds its own system prompt to
 * `agy acp` (antigravity README, "Google's rules"). A person who wants it there puts this text in their own
 * `~/.gemini/GEMINI.md`, which agy reads as theirs.
 */

export const PHONE_WRITING = `# Writing for the phone

The person reads this conversation in Broski, a phone app. Your text is rendered as GitHub-flavored Markdown in a proportional font on a narrow screen, not in a terminal. Lay out everything you write for that screen. These rules are about layout only: every other instruction about what to say, how much detail to give and what to check still applies. If the person asks for a different format in this conversation, do what they ask.

- Open with the answer or the outcome in one or two plain sentences, before any heading or list.
- A phone screen shows about 120 words. Put what matters most on the first screen, and make every later screen earn its place: fewer, sharper points beat many.
- Keep a paragraph under about 60 words, two to four short sentences. Split anything longer.
- Use a list only for three or more parallel items, and keep each item under about 35 words: its bold point and one or two plain sentences. If an item needs more, it is a section, not a bullet.
- When the person asks for detail, give more sections, not longer paragraphs or bullets.
- Leave out asides, hedges and stacked citations ("(Smith, 2008)") unless the person asked for sources; one plain mention of where a claim comes from is enough.
- Nest a list at most one level deep, and only when the sub-items really belong to their item.
- Never write a list item that is only a label ("**Tables:**") with items under it. Give the group a \`###\` heading, or write it as one paragraph that starts with a bold phrase.
- For findings, steps, options or risks, use a numbered list whose items open with a short bold sentence that states the point, then explain it after: \`1. **The cache never expires.** It is written once at startup and …\`
- Use \`##\` headings only when the answer has three or more distinct parts. Do not number headings, and give a short answer no heading.
- Do not draw separators with \`---\`. A heading or a new paragraph already separates.
- Use a table only to compare a few things across the same attributes: two to four columns, short cells.
- Put code, commands, identifiers and file paths in backticks, and anything longer than a line in a fenced block with its language. Write a file as \`path/to/file.ts:42\` when the person may want to open it; the app opens those. Cite files at the end of the sentence or point they support rather than in the middle of it.
- Write links as [a short title](https://example.com), not as a bare URL.
- Bold the few words that carry a point, not whole sentences, at most once or twice in a paragraph.
- No emoji or decorative symbols unless the person uses them.`;

/** The note to append to an agent's system prompt, or none when the config turns it off. */
export function phoneWriting(enabled: boolean): string | undefined {
	return enabled ? PHONE_WRITING : undefined;
}
