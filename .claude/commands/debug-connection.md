---
description: Debug the connection between a paired phone, the broski-link daemon and the bridge
allowed-tools: Bash, Read, Grep
---

# Debug Connection

Diagnose why a phone cannot reach the bridge: the phone talks to the `broski-link` daemon, which talks to the bridge
over `~/.broski/link/bridge.sock`.

## Commands to Run
```bash
# Is the daemon running, which devices are paired, is the bridge supervised
broski-link status

# The bridge's own checks (shell environment, link path, TLS, agents)
broski-bridge doctor

# Loopback listener (default port 18274)
lsof -i :18274

# Recent logs
tail -20 ~/.broski/logs/bridge.log
tail -20 ~/.broski/logs/link.log
```

$ARGUMENTS
