#!/bin/sh
# Broski for macOS: installs, updates and repairs ~/.broski/bin from a GitHub release.
# `broski update` runs the copy of this script published with the release it installs, so this file is the
# only code that downloads and replaces Broski: a fix here reaches every installed version on its next update.
#
#   curl -fsSL https://raw.githubusercontent.com/humblemuzzu/broski/main/packages/bridge/scripts/install.sh | sh
#   ... | sh -s -- --install-service   also register the background service on a first install
#   ... | sh -s -- --version v0.1.2    install one release instead of the latest
#   ... | sh -s -- --uninstall
#
# Environment: BROSKI_REPO (owner/repo), BROSKI_VERSION (tag), BROSKI_BASE_URL (a release's download folder).
# Nothing runs until the last line, so a script cut short while `curl | sh` downloads it does nothing.

set -eu

REPO="${BROSKI_REPO:-humblemuzzu/broski}"
VERSION_TAG="${BROSKI_VERSION:-}"
INSTALL_DIR="$HOME/.broski/bin"
STAGING="$INSTALL_DIR/.staging"
LOCK="$INSTALL_DIR/.install.lock"
LABEL="com.broski.link"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
MAX_ATTEMPTS=6
INSTALL_SERVICE=0
UNINSTALL=0
HAVE_LOCK=0
STAGED=""

say() { printf '  %s\n' "$*"; }

die() { printf '\n  Error: %s\n\n' "$*" >&2; exit 1; }

usage() { echo "Usage: install.sh [--install-service] [--version <tag>] | --uninstall"; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --install-service) INSTALL_SERVICE=1 ;;
      --uninstall) UNINSTALL=1 ;;
      --version)
        [ $# -ge 2 ] || die "--version needs a release tag, for example --version v0.1.2"
        VERSION_TAG=$2
        shift
        ;;
      --version=*) VERSION_TAG=${1#*=} ;;
      -h | --help) usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
    esac
    shift
  done
  case "$VERSION_TAG" in
    "" | v*) ;;
    *) VERSION_TAG="v$VERSION_TAG" ;;
  esac
}

remove_path_block() {
  rc_file="$1"
  [ -f "$rc_file" ] || return 0
  grep -q "$INSTALL_DIR" "$rc_file" 2> /dev/null || return 0
  awk -v dir="$INSTALL_DIR" '
    $0 == "# Broski" { skip = 1; next }
    skip && index($0, dir) > 0 { skip = 0; next }
    { skip = 0; print }
  ' "$rc_file" > "${rc_file}.broski.tmp"
  mv "${rc_file}.broski.tmp" "$rc_file"
  say "✓ Removed the PATH entry from ${rc_file}"
}

uninstall() {
  echo ""
  say "Uninstalling Broski..."
  if [ -x "${INSTALL_DIR}/broski" ]; then
    "${INSTALL_DIR}/broski" uninstall > /dev/null 2>&1 || true
  fi
  rm -rf "$INSTALL_DIR"
  for rc_file in .zshrc .bash_profile .bashrc .profile; do
    remove_path_block "$HOME/$rc_file"
  done
  say "✓ Removed ${INSTALL_DIR}"
  say "Config and pairings remain in ~/.broski (delete it yourself for a full wipe)."
  echo ""
}

detect_target() {
  case "$(uname -s)" in
    Darwin) ;;
    *) die "Broski's desktop host runs on macOS only (this is $(uname -s))." ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) ARCH=arm64 ;;
    x86_64 | amd64) ARCH=x64 ;;
    *) die "unsupported processor '$(uname -m)'. Broski supports Apple Silicon and Intel Macs." ;;
  esac
  # A terminal running under Rosetta reports x86_64 on Apple Silicon.
  if [ "$ARCH" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2> /dev/null || echo 0)" = 1 ]; then
    ARCH=arm64
  fi
  TARGET="darwin-${ARCH}"
}

cleanup() {
  rm -f "$STAGING"/*.new 2> /dev/null || true
  if [ "$HAVE_LOCK" = 1 ]; then rm -rf "$LOCK"; fi
}

take_lock() {
  if ! mkdir "$LOCK" 2> /dev/null; then
    other=$(cat "$LOCK/pid" 2> /dev/null || true)
    if [ -n "$other" ] && kill -0 "$other" 2> /dev/null; then
      die "another Broski install or update is running (process ${other}). Wait for it to finish."
    fi
    rm -rf "$LOCK"
    mkdir "$LOCK" 2> /dev/null || die "another Broski install or update just started. Wait for it to finish."
  fi
  echo $$ > "$LOCK/pid"
  HAVE_LOCK=1
}

resolve_release() {
  if [ -n "${BROSKI_BASE_URL:-}" ]; then
    BASE_URL=${BROSKI_BASE_URL%/}
    return 0
  fi
  if [ -z "$VERSION_TAG" ]; then
    redirect=$(curl -fsS --proto-redir =https --connect-timeout 20 --max-time 60 --retry 3 \
      -o /dev/null -w '%{redirect_url}' "https://github.com/${REPO}/releases/latest") ||
      die "could not reach GitHub to find the latest release. Check your connection, then run the same command again."
    case "$redirect" in
      */releases/tag/*) VERSION_TAG=${redirect##*/} ;;
      *) die "GitHub did not name a latest release for ${REPO}." ;;
    esac
  fi
  BASE_URL="https://github.com/${REPO}/releases/download/${VERSION_TAG}"
}

sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }

expected_sha256() {
  awk -v file="$1" '$2 == file || $2 == ("*" file) { print $1; exit }' "$STAGING/SHA256SUMS"
}

curl_reason() {
  case "$1" in
    6) echo "the server's address could not be found" ;;
    7) echo "the server could not be reached" ;;
    18 | 52 | 55 | 56 | 92) echo "the connection dropped" ;;
    28) echo "the download stalled" ;;
    33) echo "the server would not resume the download" ;;
    35 | 60) echo "the secure connection failed" ;;
    *) echo "the download failed (curl error $1)" ;;
  esac
}

# One resumable transfer of $1 into $2; prints the HTTP status.
fetch_once() {
  if [ -t 2 ]; then progress=--progress-bar; else progress=--silent; fi
  curl --fail --location --proto-redir =https --show-error "$progress" \
    --connect-timeout 30 --speed-time 60 --speed-limit 1024 \
    --continue-at - --output "$2" --write-out '%{http_code}' "$1"
}

# Downloads release asset $1 into $2 until its sha256 is $3, resuming across attempts and across runs.
download_verified() {
  name=$1
  part=$2
  want=$3
  if [ -f "$part" ] && [ "$(sha256_of "$part")" = "$want" ]; then return 0; fi
  say "Downloading ${name}..."
  attempt=1
  while :; do
    if code=$(fetch_once "${BASE_URL}/${name}" "$part"); then
      [ "$(sha256_of "$part")" = "$want" ] && return 0
      rm -f "$part"
      why="the download did not match its checksum"
    else
      rc=$?
      case "$code" in
        401 | 403 | 404)
          rm -f "$part"
          die "${name} is not in the release (HTTP ${code} from ${BASE_URL})."
          ;;
        416)
          rm -f "$part"
          why="the saved partial download was stale"
          ;;
        5[0-9][0-9]) why="the server answered HTTP ${code}" ;;
        *)
          if [ "$rc" = 33 ]; then rm -f "$part"; fi
          why=$(curl_reason "$rc")
          ;;
      esac
    fi
    if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
      die "could not download ${name}: ${why}. Run the same command again to resume."
    fi
    pause=$((attempt * 2))
    [ "$pause" -le 10 ] || pause=10
    if [ -s "$part" ]; then next=resuming; else next="starting again"; fi
    say "${why}; ${next} in ${pause}s (attempt $((attempt + 1)) of ${MAX_ATTEMPTS})..."
    sleep "$pause"
    attempt=$((attempt + 1))
  done
}

tar_reads_xz() { tar --version 2> /dev/null | grep -q lzma; }

# Stages release file $1 as $STAGING/$2.new unless the installed $2 already matches; 1 when not released.
stage() {
  raw=$1
  dest=$2
  raw_sha=$(expected_sha256 "$raw")
  [ -n "$raw_sha" ] || return 1
  if [ -f "${INSTALL_DIR}/${dest}" ] && [ "$(sha256_of "${INSTALL_DIR}/${dest}")" = "$raw_sha" ]; then
    say "✓ ${dest} is up to date"
    return 0
  fi
  asset=$raw
  unpack="cat"
  if [ -n "$(expected_sha256 "${raw}.tar.xz")" ] && tar_reads_xz; then
    asset="${raw}.tar.xz"
    unpack="tar -xOf"
  elif [ -n "$(expected_sha256 "${raw}.gz")" ]; then
    asset="${raw}.gz"
    unpack="gzip -dc"
  fi
  asset_sha=$(expected_sha256 "$asset")
  part="${STAGING}/${asset}.$(printf '%s' "$asset_sha" | cut -c1-12).part"
  download_verified "$asset" "$part" "$asset_sha"
  $unpack "$part" > "${STAGING}/${dest}.new" ||
    die "could not unpack ${asset}. Is the disk full? Free some space, then run the same command again."
  if [ "$(sha256_of "${STAGING}/${dest}.new")" != "$raw_sha" ]; then
    rm -f "$part"
    die "${asset} unpacked to the wrong bytes. Run the same command again to download it afresh."
  fi
  chmod 755 "${STAGING}/${dest}.new"
  STAGED="${STAGED} ${dest}"
  say "✓ ${asset} verified"
}

is_staged() {
  case " $STAGED " in *" $1 "*) return 0 ;; esac
  return 1
}

# Runs staged binary $1 with --version; it must print a line starting "$2" (config warnings may come first).
smoke_test_one() {
  is_staged "$1" || return 0
  out=$("${STAGING}/$1.new" --version 2>&1) || true
  printf '%s\n' "$out" | grep -q "^$2" ||
    die "the new $1 did not start on this Mac, so nothing was replaced. It said: ${out}"
}

# Keeps partial downloads, which resume; drops whatever else an interrupted run left behind.
prepare_staging() {
  mkdir -p "$STAGING"
  for f in "$STAGING"/* "$STAGING"/.[!.]*; do
    [ -e "$f" ] || continue
    case "$f" in *.part) ;; *) rm -rf "$f" ;; esac
  done
}

# Also clears what earlier installers and in-binary updaters left next to the binaries.
remove_leftovers() {
  rm -rf "$STAGING"
  rm -f "$INSTALL_DIR"/*.part "$INSTALL_DIR"/*.new "$INSTALL_DIR/SHA256SUMS" \
    "$INSTALL_DIR"/.broski-part-* "$INSTALL_DIR"/.broski-new-* "$INSTALL_DIR"/.broski-backup-* \
    "$INSTALL_DIR"/.broski-update-* 2> /dev/null || true
}

# Downloads and checks everything first; only then replaces the installed files, all together.
install_release() {
  prepare_staging
  curl -fsS --proto-redir =https --location --connect-timeout 30 --max-time 120 --retry 3 \
    "${BASE_URL}/SHA256SUMS" -o "$STAGING/SHA256SUMS" ||
    die "could not download SHA256SUMS from ${BASE_URL}. Check your connection, then run the same command again."
  stage "broski-${TARGET}" broski || die "this release has no Broski for ${TARGET}."
  stage "broski-link-${TARGET}" broski-link || say "⚠ This release has no broski-link for ${TARGET}."
  stage libbroski_pty.dylib libbroski_pty.dylib || true
  smoke_test_one broski "broski v"
  smoke_test_one broski-link "broski-link "
  for dest in $STAGED; do
    mv -f "${STAGING}/${dest}.new" "${INSTALL_DIR}/${dest}"
  done
  remove_leftovers
}

# Terminal.app starts bash as a login shell, which reads ~/.bash_profile and not ~/.bashrc.
ensure_path() {
  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) return 0 ;;
  esac
  case "$(basename "${SHELL:-/bin/sh}")" in
    zsh) profile="$HOME/.zshrc" ;;
    bash) profile="$HOME/.bash_profile" ;;
    fish)
      fish -c "set -Ux fish_user_paths $INSTALL_DIR \$fish_user_paths" 2> /dev/null || true
      say "✓ Added ${INSTALL_DIR} to PATH (fish)"
      return 0
      ;;
    *) profile="$HOME/.profile" ;;
  esac
  if ! grep -q "$INSTALL_DIR" "$profile" 2> /dev/null; then
    printf '\n# Broski\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$profile"
    say "✓ Added ${INSTALL_DIR} to PATH in ${profile} (open a new terminal to use it)"
  fi
}

# none | foreign (the service runs binaries from another folder) | stopped | loaded
service_state() {
  [ -f "$PLIST" ] || { echo none; return 0; }
  grep -q "<string>${INSTALL_DIR}/broski-link</string>" "$PLIST" || { echo foreign; return 0; }
  if launchctl print "gui/$(id -u)/${LABEL}" > /dev/null 2>&1; then echo loaded; else echo stopped; fi
}

wait_for_bridge() {
  tries=0
  while [ "$tries" -lt 60 ]; do
    if "${INSTALL_DIR}/broski-link" status 2> /dev/null | grep -Eq '^bridge[[:space:]]+up$'; then return 0; fi
    sleep 0.5
    tries=$((tries + 1))
  done
  return 1
}

# Returns 1 when there is no background service.
restart_service() {
  case "$(service_state)" in
    none) return 1 ;;
    foreign) say "The background service runs Broski from another folder (${PLIST}); it was left alone." ;;
    stopped) say "The background service is installed but not loaded. Start it with: broski restart" ;;
    loaded)
      say "Restarting Broski..."
      if ! launchctl kickstart -k "gui/$(id -u)/${LABEL}" > /dev/null 2>&1; then
        say "Could not restart the background service. Run: broski restart"
      elif wait_for_bridge; then
        say "✓ Broski restarted. Your phone stays paired."
      else
        say "Broski restarted and is still starting. Check it with: broski-link status"
      fi
      ;;
  esac
  return 0
}

finish() {
  installed=$("${INSTALL_DIR}/broski" --version 2> /dev/null | awk '$1 == "broski" {print $2; exit}' || true)
  echo ""
  if [ -z "$STAGED" ]; then
    say "✓ Broski ${installed} is already installed and up to date."
  elif restart_service; then
    say "✓ Broski ${installed} is installed."
    echo ""
    return 0
  else
    say "✓ Broski ${installed} is installed."
  fi
  if [ "$(service_state)" != none ]; then
    echo ""
    return 0
  fi
  if [ "$INSTALL_SERVICE" = 1 ]; then
    say "Installing the background service..."
    "${INSTALL_DIR}/broski" install
    echo ""
    return 0
  fi
  echo ""
  say "Next steps:"
  say "  broski install       # run Broski in the background, starting at login"
  say "  broski-link pair     # show the QR code to pair your phone"
  if [ -n "$STAGED" ]; then say "If you run broski in a terminal instead, restart it to use the new version."; fi
  echo ""
}

main() {
  parse_args "$@"
  [ "$(id -u)" != 0 ] || die "run this without sudo. Broski installs into your own home folder and runs as your login service."
  if [ "$UNINSTALL" = 1 ]; then
    uninstall
    return 0
  fi
  detect_target
  mkdir -p "$INSTALL_DIR" 2> /dev/null || die "cannot create ${INSTALL_DIR}. Check who owns it: ls -ld ~/.broski"
  [ -w "$INSTALL_DIR" ] || die "cannot write to ${INSTALL_DIR}. Check who owns it: ls -ld ~/.broski ~/.broski/bin"
  trap cleanup EXIT
  trap 'printf "\n  Stopped. Run the same command again to pick up where it left off.\n\n" >&2; exit 130' INT TERM HUP
  take_lock
  echo ""
  resolve_release
  say "Installing Broski ${VERSION_TAG:-from ${BASE_URL}} for ${TARGET}"
  echo ""
  install_release
  ensure_path
  finish
}

main "$@"
