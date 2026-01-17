---
description: Debug bridge connection issues between app and server
allowed-tools: Bash, Read, Grep
---

# Debug Connection

Diagnose connection issues between the Broski app and bridge server.

## Diagnostic Steps

1. Check if bridge server is running
2. Verify port availability (default: 4321)
3. Check for firewall issues
4. Verify AI backend availability
5. Check recent logs for errors

## Commands to Run
```bash
# Check bridge process
pgrep -f broski-bridge

# Check port
lsof -i :4321

# Check logs
tail -20 ~/.broski/logs/bridge.log
```

$ARGUMENTS
