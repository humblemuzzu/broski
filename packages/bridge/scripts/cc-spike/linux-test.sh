#!/bin/sh
# Runs the bridge tests in a throwaway Linux container set up like CI's ubuntu runner: a non-root user whose
# checkout lives under its home, gcc, git, zsh and procps installed, `bun install --frozen-lockfile` run inside
# the container (so the Linux optional `claude` package is installed), then `bun test`. The repo is mounted
# read-only and copied; no host home directory is mounted.
#
# Usage (from packages/bridge):
#   sh scripts/cc-spike/linux-test.sh [--platform linux/amd64] [--repo <path>] [--bun <version>] [--detach <name>]
#     [bun test args...]
# `--detach` runs the container in the background under that name (follow it with `docker logs -f <name>`).
set -e

PLATFORM_ARGS=""
RUN_ARGS="--rm"
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
while [ $# -gt 0 ]; do
  case "$1" in
    --platform) PLATFORM_ARGS="--platform $2"; shift 2 ;;
    --repo) REPO=$(cd "$2" && pwd); shift 2 ;;
    --bun) BUN_VERSION="$2"; shift 2 ;;
    --detach) RUN_ARGS="-d --name $2"; shift 2 ;;
    *) break ;;
  esac
done
: "${BUN_VERSION:=$(grep -o '"bun": *">=[0-9.]*"' "${REPO}/packages/bridge/package.json" | grep -o '[0-9][0-9.]*')}"

# shellcheck disable=SC2086
exec docker run $RUN_ARGS $PLATFORM_ARGS -v "${REPO}:/src:ro" -e TEST_ARGS="$*" "oven/bun:${BUN_VERSION}" sh -c '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null && apt-get install -y -qq build-essential git procps zsh >/dev/null
  useradd -m runner
  mkdir -p /home/runner/work && cd /src
  tar --exclude=node_modules --exclude=dist --exclude=build --exclude=target \
    --exclude=.git -cf - . | tar -C /home/runner/work -xf -
  chown -R runner:runner /home/runner/work
  exec su runner -s /bin/sh -c "
    set -e
    cd /home/runner/work/packages/bridge
    bun install --frozen-lockfile 2>&1 | tail -1
    ls node_modules/@anthropic-ai/ | tr \"\\n\" \" \"; echo
    echo \"\$(uname -m) bun \$(bun --version) user \$(id -un)\"
    start=\$(date +%s)
    status=0
    bun test $TEST_ARGS || status=\$?
    echo \"wall: \$(( \$(date +%s) - start ))s, exit \${status}\"
    exit \$status
  "
'
