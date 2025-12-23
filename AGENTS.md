# Repository Guidelines

## Project Structure & Module Organization
- `lib/` holds the Flutter application code (currently `lib/main.dart`).
- `test/` contains Flutter tests (see `test/widget_test.dart`).
- `docs/` stores project documentation, with `docs/mvp/` as the current MVP reference.
- Platform folders like `android/`, `ios/`, `macos/`, `linux/`, `windows/`, and `web/` contain native build targets.
- `web-ui-cc/` is an auxiliary web UI workspace; keep changes scoped if you touch it.

## Build, Test, and Development Commands
- `flutter pub get` installs Dart/Flutter dependencies.
- `flutter run` starts the app on a connected device or simulator.
- `flutter run -d chrome` runs the app in a web browser.
- `flutter test` runs the full Flutter test suite.
- `flutter analyze` runs static analysis using `analysis_options.yaml`.
- `dart format .` formats all Dart files in the repo.

## Coding Style & Naming Conventions
- Follow standard Flutter/Dart style: 2-space indentation and trailing commas where it improves formatting.
- Use `UpperCamelCase` for types, `lowerCamelCase` for variables/functions, and `snake_case.dart` for files.
- Keep widgets small and composable; prefer extracting reusable UI into separate widgets.
- Lint rules come from `analysis_options.yaml` via `flutter_lints`.

## Testing Guidelines
- Tests use `flutter_test`; write new tests in `test/` with `*_test.dart` naming.
- Prefer `testWidgets` for UI behavior and keep tests deterministic.
- Run a single test file with `flutter test test/your_file_test.dart` when iterating.

## Commit & Pull Request Guidelines
- Git history is minimal, so use short, imperative commit subjects (e.g., “Add connection screen”).
- Keep commits focused on one logical change.
- PRs should include a brief summary, testing notes, and screenshots for UI changes.
- Link related issues or documentation updates when applicable.

## Documentation & Specs
- Treat `docs/mvp/` as the source of truth for requirements and update it when behavior changes.

## Continuity Ledger (compaction-safe)
Maintain a single Continuity Ledger for this workspace in "CONTINUITY md'. The ledger is the canonical session briefing designed to survive context compaction; do not rely on earlier chat text unless it's reflected in the ledger.

### How it works
- At the start of every assistant turn: read 'CONTINUITY md', update it to reflect the latest goal/constraints/decisions/state, then proceed with the work.
- Update 'CONTINUITY.md" again whenever any of these change: goal, constraints/assumptions, key decisions, progress state (Done/Now/Next), or important tool outcomes.
- Keep it short and stable: facts only, no transcripts. Prefer bullets. Mark uncertainty as 'UNCONFIRMED' (never guess).
- If you notice missing recall or a compaction/summary event: refresh/rebuild the ledger from visible context, mark gaps
"UNCONFIRMED"
, ask up to 1-3 targeted questions, then continue.
###'functions. update_plan vs the Ledger
- "functions. update_plan' is for short-term execution scaffolding while you work (a small 3-7 step plan with pending/in_progress/completed).
- "CONTINUITY md" is for long-running continuity across compaction (the "what/why/current state"), not a step-by-step task list.
- Keep them consistent: when the plan or state changes, update the ledger at the intent/progress level (not every micro-step).

### In replies
- Begin with a brief "Ledger Snapshot" (Goal + Now/Next + Open Questions). Print the full ledger only when it materially changes or when the user asks.
###'CONTINUITY.md" format (keep headings)
- Goal (incl. success criteria):
- Constraints/Assumptions:
- Key decisions:
- State:
- Done:
- Now:
- Next:
- Open questions (UNCONFIRMED if needed) :
- Working set (files/ids/commands) :

### Don't use mgrep use your own file search and read or whatever tools but not mgrep