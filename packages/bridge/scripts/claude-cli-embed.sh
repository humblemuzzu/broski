#!/bin/sh
# Sourced by scripts/build.sh and scripts/cc-spike/build-compiled-probe.sh.
#
# The Claude Code binary each compiled bridge carries (plan D3): the Agent SDK's
# optional package for the target. Bun installs only the host's by default;
# `bun install --os='*' --cpu='*'` installs every platform's for cross builds.

CLAUDE_EMBED="./src/_claude_cli_embed.ts"

claude_cli_package() {
  echo "@anthropic-ai/claude-agent-sdk-$1"
}

claude_cli_binary() {
  echo "node_modules/$(claude_cli_package "$1")/claude"
}

# Generates the module that imports the target's binary `with { type: "file" }`
# and registers its $bunfs path for src/server/claude-cli-path.ts.
write_claude_cli_embed() {
  cat > "$CLAUDE_EMBED" <<EOF
import claudeCli from "$(claude_cli_package "$1")/claude" with { type: "file" };
import { registerEmbeddedClaudeCli } from "./server/claude-cli-embedded";

registerEmbeddedClaudeCli(claudeCli);
EOF
}
