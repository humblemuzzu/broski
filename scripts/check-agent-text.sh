#!/usr/bin/env bash
# THE RULE (AGENTS.md, "Formatting agent text"): every string an agent wrote is drawn through the
# formatter's views, never a bare Text. This fails on a `Text(` in either app, outside the
# formatter's own directories, whose argument reads a field agents write (`row.text`,
# `request.reason`, `tool.output`, …). A deliberate exception is a line of
# scripts/agent-text-allowlist.txt: `path | the code it allows | why`.
#
# It reads the field where it is drawn; a value first copied into a local of another name passes,
# so the formatter's views stay the way agent text is drawn and this catches the direct slip.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
allowlist="$root/scripts/agent-text-allowlist.txt"
# One-line titles and labels (an ask's title, a button's label) are drawn plain on purpose and are
# not in this list.
fields='text|output|body|reason|summary|plan|report|thinking|answer|error|message|question|prompt|detail|content|result|description|preview|snippet'
read_field="([A-Za-z_][A-Za-z0-9_]*[?!]?\.)+($fields)([^A-Za-z0-9_(.]|\$)"
# `Text(x.text)`, `Text( x.text)`, `Text(verbatim: x.text)` and `Text("\(x.text)")` in Swift;
# `Text(x.text)` and `Text(…, text = x.text)` in Kotlin.
swift="(^|[^A-Za-z0-9_])Text\( *(verbatim: *|\"[^\"]*\\\\\()?$read_field"
kotlin="(^|[^A-Za-z0-9_])Text\( *(([^)]*[ ,])?text *= *)?$read_field"

cd "$root"
hits="$(
  {
    grep -rnE "$swift" apps/ios/Broski/Sources apps/ios/Broski/Shared apps/ios/Broski/Extensions --include='*.swift' |
      grep -v '^apps/ios/Broski/Sources/Formatting/' || true
    grep -rnE "$kotlin" apps/android/app/src/main/kotlin --include='*.kt' |
      grep -v '/design/format/' || true
  }
)"

failed=0
while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  path="${hit%%:*}"
  code="${hit#*:*:}"
  allowed=0
  while IFS='|' read -r allow_path allow_code _; do
    allow_path="$(echo "$allow_path" | xargs)"
    allow_code="$(echo "$allow_code" | sed -e 's/^ *//' -e 's/ *$//')"
    [ -n "$allow_path" ] || continue
    if [ "$path" = "$allow_path" ] && [[ "$code" == *"$allow_code"* ]]; then
      allowed=1
      break
    fi
  done < <(grep -v '^#' "$allowlist")
  if [ "$allowed" = 0 ]; then
    echo "error: agent text drawn without the formatter: $hit" >&2
    failed=1
  fi
done <<< "$hits"

if [ "$failed" = 1 ]; then
  echo "Draw it with FormattedText / FormattedMessage (or a tool view), or add the line to scripts/agent-text-allowlist.txt with why." >&2
  exit 1
fi
echo "Agent text: every direct read is drawn through the formatter."
