#!/usr/bin/env bash
# Refuses personal details: the maintainer's private patterns (.private/personal-patterns.txt, never
# committed: one case-insensitive extended regex per line, # comments) plus what this machine gives
# away by itself (its home directory, its host names, a git email that is not GitHub's noreply).
#
# Usage:
#   scripts/check-personal-info.sh --staged          lines a commit adds (the pre-commit hook)
#   scripts/check-personal-info.sh --message FILE    a commit message (the commit-msg hook)
#   scripts/check-personal-info.sh --tree            every tracked file
#   scripts/check-personal-info.sh --history         every commit on every branch and tag, and every message
#   scripts/check-personal-info.sh --files PATH...   built files: binaries, .apk, .ipa, .zip (by their strings)
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PRIVATE="$ROOT/.private/personal-patterns.txt"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Fixed strings this machine knows about itself.
{
  printf '%s\n' "$HOME"
  for name in "$(scutil --get LocalHostName 2>/dev/null || true)" "$(scutil --get ComputerName 2>/dev/null || true)" \
    "$(hostname -s 2>/dev/null || true)"; do
    if [[ ${#name} -ge 6 && $name != localhost ]]; then printf '%s\n' "$name"; fi
  done
  email="$(git config user.email 2>/dev/null || true)"
  if [[ -n $email && $email != *noreply* ]]; then printf '%s\n' "$email"; fi
} | sort -u >"$work/fixed"

if [[ -f $PRIVATE ]]; then
  grep -v -E '^[[:space:]]*(#|$)' "$PRIVATE" >"$work/regex" || true
else
  : >"$work/regex"
fi

# Prints the lines of stdin that match, prefixed with $1; returns 1 when any did.
scan() {
  local label=$1 found=0
  cat >"$work/input"
  : >"$work/hits"
  if [[ -s $work/fixed ]] && grep -n -i -F -f "$work/fixed" "$work/input" >"$work/hits"; then found=1; fi
  if [[ -s $work/regex ]] && grep -n -i -E -f "$work/regex" "$work/input" >>"$work/hits"; then found=1; fi
  if ((found)); then
    echo "  ✗ personal details in $label:" >&2
    sort -u -t: -k1,1n "$work/hits" | cut -c1-200 | sed 's/^/      /' >&2
    return 1
  fi
}

status=0
case "${1:---staged}" in
  --staged)
    git diff --cached -U0 --no-color --no-ext-diff | { grep -E '^\+' || true; } | { grep -v -E '^\+\+\+ ' || true; } |
      scan "the staged changes" || status=1
    ;;
  --message)
    { grep -v '^#' "$2" || true; } | scan "the commit message" || status=1
    ;;
  --tree)
    git -C "$ROOT" ls-files -z | (cd "$ROOT" && xargs -0 grep -I -H -n "" 2>/dev/null || true) | scan "tracked files" || status=1
    ;;
  --history)
    git -C "$ROOT" log --all -p --no-color --format='commit %H%n%an <%ae>%n%cn <%ce>%n%B' | scan "history" || status=1
    git -C "$ROOT" for-each-ref refs/tags --format='%(taggername) %(taggeremail) %(contents)' | scan "tags" || status=1
    ;;
  --files)
    shift
    # strings fails on some members of an archive (a malformed fat file); what it read still counts.
    # Apple's signing profiles name the developer account by design and are skipped, as is an IPA's Symbols/
    # (crash symbols App Store Connect keeps for the developer; no phone receives them): see .private/PRIVACY.md.
    for file in "$@"; do
      case "$file" in
        */embedded.mobileprovision | embedded.mobileprovision)
          echo "  (skipped Apple's signing profile $file)"
          ;;
        *.apk | *.ipa | *.zip | *.aab)
          unpacked="$(mktemp -d "$work/unzip.XXXXXX")"
          unzip -q -o "$file" -d "$unpacked"
          [[ -d $unpacked/Symbols ]] && echo "  (skipped the crash symbols in $file, which only Apple receives)"
          { find "$unpacked" -type f ! -name embedded.mobileprovision ! -path "$unpacked/Symbols/*" \
            -exec strings -a {} + 2>/dev/null || true; } | scan "$file" || status=1
          ;;
        *.gz) { gzip -dc "$file" | strings -a 2>/dev/null || true; } | scan "$file" || status=1 ;;
        *) { strings -a "$file" 2>/dev/null || true; } | scan "$file" || status=1 ;;
      esac
    done
    ;;
  *)
    echo "usage: $0 [--staged | --message FILE | --tree | --history | --files PATH...]" >&2
    exit 64
    ;;
esac

if ((status)); then
  echo "  Replace them with neutral examples (see AGENTS.md, Personal details)." >&2
  exit 1
fi
[[ -f $PRIVATE ]] || echo "  (no .private/personal-patterns.txt: checked this machine's own names only)"
