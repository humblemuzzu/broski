# How a Pi extension shows on the phone

A Pi extension draws in the terminal with Pi's own components (`registerMessageRenderer`, widgets, `ui.custom`). None
of that crosses `pi --mode rpc` (pi-coding-agent 1.5.2 `docs/rpc-extension-ui.md:12-23`), so the phone cannot use it.
What does cross is data: a custom message's `customType`, `content` and `details`, and Pi's event bus. An extension
that wants more than a plain card on the phone says what to show in that data, in the contract's own shapes
(`packages/bridge/src/contract/activity.ts`). An extension that says nothing still shows, plainly.

## A message: `details.broski`

```ts
pi.sendMessage({
  customType: "bash-job",
  content: text,           // what the model reads
  display: true,
  details: {
    ...yourOwnDetails,
    broski: {
      kind: "task",        // "task" | "agent" | "command" | "message"
      title: "bash-6bfa failed after 1h00m",
      status: "failed",    // optional: "running" | "completed" | "failed" | "stopped"
      command: "tail -F /tmp/daemon.log",   // optional, shown monospaced
      durationMs: 3_600_000,                // optional
      exitCode: 1,                          // optional
      body: { format: "log", text: output } // optional: "markdown" | "text" | "log"
    },
  },
});
```

- `broski` is an `Activity` without `childSession` (an extension knows none of the bridge's sessions). Unknown keys
  inside it are ignored; a hint that does not parse is ignored as a whole and the message shows plainly.
- A `log` body keeps its newest 64 KiB; the phone shows its last lines and opens the rest on a tap. Any other body is
  cut to the contract's text bound.
- The phone shows the activity as one quiet row in the transcript (`mapping/custom-activity.ts`), live and from the
  session file alike, since the hint is stored with the message.

Without a hint, a displayed message (`display: true`) shows as Pi's terminal shows a message no renderer claims
(`dist/modes/interactive/components/custom-message.js:72-93`): its `customType` as the title ("bash-job" reads
"Bash job") over its text as markdown. A message with `display: false` shows nothing, as in the terminal.

## A tool's result: `details.broski`

A tool an extension registers may return a `details.broski` that is a `ToolDisplay`, and the phone shows it in place
of the result's text (`mapping/display-hint.ts`):

```ts
return {
  content: [{ type: "text", text }],   // what the model reads
  details: { ...yourOwnDetails, broski: { kind: "files", paths, total } },
};
// or { kind: "todos", items: [{ text, status: "pending" | "in_progress" | "completed" }] }
// or { kind: "links", items: [{ title, url, snippet? }] }   (http(s) URLs only)
```

A failed result shows its error, never a display; a hint that does not parse is ignored and the text shows.

## Questions: `broski:questions`

An extension that asks the person something in a picker of its own (`ctx.ui.custom`, which no other extension can
read) announces the questions on Pi's event bus, and the Broski app answers them as one questions card:

```ts
const ended = new AbortController(); // abort once answered in the terminal, or no longer wanted
let claimed = false;
const fromPhone = new Promise((resolve) => {
  pi.events.emit("broski:questions", {
    title: "Store", // optional
    questions: [{ question: "Which store?", header: "Store", options: [{ label: "Redis", description: "deployed" }], multiple: false }],
    signal: ended.signal,
    claim: () => { claimed = true; }, // called at once by whatever will answer
    answer: resolve, // [{ selected: string[], custom?: string }] per question, or undefined
  });
});
```

- `claim()` runs synchronously inside `emit` when the bridge's extension is there: the link extension in a terminal's
  `pi`, the host extension in a `pi` the bridge runs. Nothing claims it otherwise.
- In a terminal, show your own picker as well and take whichever answers first; abort `signal` when the terminal
  answered, and the phone's card is withdrawn. In a session the bridge hosts (`ctx.mode` is `rpc`), a claimed question
  is answered by the phone alone.
- Every question takes the person's own words besides its options; a single-choice question gets one pick or the
  words, not both. A dismissal is `undefined`.

Pi's own `select`, `confirm` and `input` need nothing: in a terminal the link extension shows them on the phone too,
and the first answer wins (`terminal/extension/dialogs.ts`). `editor` takes no signal, so it stays the terminal's.

## Work in the background: `broski:tasks`

```ts
pi.events.emit("broski:tasks", [
  { id: "bash-6bfa", kind: "task", title: "tail the daemon log", command: "tail -F /tmp/daemon.log", startedAt: Date.now() },
]);
```

- The whole list each time, `[]` when nothing runs. Each entry is a `BackgroundTask` without `childSession`; an entry
  that does not parse is left out.
- The bridge's own extensions pass it on: in a `pi` the bridge hosts, `broski-host` relays it as a `setStatus` under the
  same key (`host/extension/index.ts`); in a terminal's `pi`, the link extension sends it as a `tasks` event and keeps
  the last list in its snapshot (`terminal/extension/link.ts`). Neither shows anything in a terminal.
- While the list is not empty the session stays open on the bridge, viewed or not (`core/keep-open.ts`): closing it
  would end the `pi` process and its tasks with it. When the process ends, the list empties.
- The phone shows the running tasks as one pill above the composer, and each task's end is the activity its extension
  sends.
