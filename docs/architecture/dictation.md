# Dictation

The composer's mic turns speech into prompt text, in both apps and in New session. The phone records
and uploads; the bridge and the Mac take no part, so dictation works while the Mac is out of reach.

```
mic → AAC .m4a (16 kHz mono, 32 kbit/s) ─┐
session items, folder listing, git status ┼→ broski-voice: up to 100 names → multipart request
the person's own words ──────────────────┘                     │
                                       the app POSTs it to api.x.ai/v1/stt
                                                               │
                         broski-voice reads the answer → text into the draft, or a problem
```

## Why xAI's Grok Voice Transcribe 2.0, uploaded once

Measured on 16 Nov 2026 (`/tmp/sttbench`, not committed): 12 developer prompts of about 10 s, spoken
by macOS voices in US and Indian English, 64 terms that must come out as typed (`useEffect`,
`contract/limits.ts`, `UniFFI`, `kubectl rollout restart`), from India.

| Engine | Terms exactly right | Wait after release, 10 s clip | Price |
|---|---|---|---|
| Apple SpeechTranscriber | 21/64 | on device | free |
| Apple DictationTranscriber + the names as context | 34/64 | on device | free |
| Parakeet TDT 0.6B v3 | 29/64 | on device | free |
| Grok 2.0, upload | 38/64 | 678 ms p50 | $0.10/h |
| Grok 2.0, upload + names as key terms | 46/64 | 647 ms p50 | $0.10/h |
| Gemini 3.5 Transcribe + vocabulary | 61/64 | 3.4 s | ~$0.32/h |

Grok is the one model that is fast, cheap and a real speech model: its formatting writes "use effect
hook in session view dot T S X" as `useEffect hook in sessionView.tsx`, it returns nothing for
silence where Gemini Flash-Lite invented "Hello" from it five times out of five, and its answer time
stayed between 557 and 868 ms over 24 uploads. On Artificial Analysis' board it scores 2.3% WER at
182× real time. Streaming would return the text about 0.2 s sooner for twice the price; the upload
is what ships.

A hundred key terms, 71 of them unrelated to what was said, put none of them into a transcript and
did not lower accuracy, so the list is filled to the limit.

## The shared part: `packages/link/voice` (`broski-voice`)

Pure, no I/O, exported through BroskiCore like `decisionLetter`:

- `dictationTerms(sources:)` — the names for the model, best first, at most 100 of at most 50
  characters (xAI's limits). The person's own words come first, then the project folder's name, then
  what ranks highest: inline code and identifiers in the newest 120 transcript items (the person's
  weighted over the agent's, thinking and subagent text at half), the paths and commands of tool
  calls (read through `broski-render`'s `tool_look`, as the work fold reads them), changed files and
  the branch from git status, and the session folder's entries. A name's weight halves every 15
  items back. Code blocks are skipped: their keywords are not what anyone says. Plain English and
  lowercase folder names like `src` are left out; the model spells those already.
- `dictationRequest(apiKey:audio:fileName:mimeType:language:terms:)` — the `multipart/form-data`
  upload: `model=grok-voice-transcribe-2.0`, `language` and `format=true` when the language is one xAI
  formats, `keyterm` × n, the file last (xAI ignores fields after it). The boundary is random and
  checked absent from every part.
- `dictationKeyCheck(apiKey:)` — the same upload of 250 ms of silence: a working key gets an empty
  transcript, so Save in Voice settings proves the key can transcribe, not only that it exists.
- `dictationResult(status:body:)` — the transcript, or a `DictationError`: `InvalidKey` (401, or 400
  naming the API key, which is how xAI refuses a wrong one), `OutOfCredits` (credit or spending-limit
  words on any 4xx, or 402), `Forbidden`, `RateLimited`, `TooLarge`, `Rejected` (audio xAI could not
  decode), `Unavailable` (5xx), `Unexpected`. `dictationErrorRetryable(error:)` says whether the same
  recording may go again.
- `dictationLanguages()` — xAI's 38 languages, marked where it formats.

## The apps

| | iOS | Android |
|---|---|---|
| Controller | `Core/Voice/Dictation.swift`, one per app on `AppModel` | `core/voice/Dictation.kt`, one per process on `AppCore`, given to composers through `LocalDictation` |
| Recorder | `AVAudioRecorder`, `.playAndRecord` ducking other audio | `MediaRecorder`, `VOICE_RECOGNITION` source, transient audio focus |
| Upload | `URLSession` (ephemeral, 30 s request, 180 s resource) | `HttpURLConnection` (15 s connect, 60 s read) |
| Key | the app's keychain, `xai-api-key` | the vault, sealed, `voice:xai-key` |
| Settings | `@AppStorage` `voice.*`, Settings › Voice | `SettingsStore` `voice.*`, Settings › Voice |
| No key | this iPhone's `DictationTranscriber`, with the names as `contextualStrings` | the phone's own recognizer (`RecognizerIntent`) |
| No connection | the same on-device fallback | the recording is kept for Try again |

The gesture: the recording starts on touch down. Held past 350 ms, release inserts and sliding 70 pt
left cancels; a shorter press keeps recording without the finger, and the mic becomes ✓ (insert)
beside ✕ (cancel). A recording under 500 ms is a slip and is dropped. Ten minutes is the most one
recording takes (2.4 MB). While dictating, the waveform and timer take the field's place; then
"Transcribing…"; then the text joins the draft after one space, or the failure shows what to do
(Try again keeps the recording; a key problem leads to Voice settings; a refused microphone to the
system's settings). "Send after dictating" sends the draft as the composer's button would. The app
leaving the screen ends a recording and transcribes it in the background time the system gives.

The names are gathered while the person speaks and waited on for at most 1.5 s once they stop: the
folder listing and git status come from the Mac (`fs.list`, `git.status`, at most once a minute per
folder), and a Mac that does not answer only means fewer names.

## Tests

- `cargo test -p broski-voice`: the name rules on real shapes (identifiers, paths, commands, prose),
  ranking and limits, the multipart layout read back field by field, xAI's own refusals as they came
  back, languages. `packages/link/mobile/tests/voice.rs` calls the exports.
- iOS `VoiceTests`, Android `VoiceTest`: the core's request reaches a local server byte for byte
  with its headers, a refused key asks for Voice settings, which failures are retryable, the key and
  settings round trip.
- `scripts/e2e-ios-app.sh` (`VoiceEndToEndTests`): words and, given `BROSKI_E2E_XAI_KEY`, a key xAI
  checked; then a tapped and a held recording in a chat, each of which has to come back from xAI. The
  Mac says a line for its microphone; where the simulator hears silence, the round trip still has to
  end in "Didn't catch any words." Without a key the chat part is skipped: a simulator has no
  on-device speech models (`bestAvailableAudioFormat` answers `nil`, which the app reports).
- `scripts/test-android-real-machine.sh` (`RealMachineTest#u_…`, `VoiceFlow`): the same on the
  emulator, given `BROSKI_E2E_XAI_KEY`; `BROSKI_ANDROID_TESTS` runs it alone with the pairing test.
