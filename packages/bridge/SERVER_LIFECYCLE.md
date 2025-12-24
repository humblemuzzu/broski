# Bridge Server Lifecycle Management

The Broski bridge now provides flexible OpenCode server lifecycle management using the SDK's `createOpencodeServer()` function, similar to how the VS Code extension manages OpenCode instances.

## Connection Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    STARTUP FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User runs: bun run dev                                          │
│         │                                                          │
│         ▼                                                          │
│  ┌──────────────────────────────────────────────┐                   │
│  │ Check OPENCODE_BASE_URL env var         │                   │
│  └──────────────────┬───────────────────────┘                   │
│                     │                                            │
│           ┌─────────┴─────────┐                                  │
│           │ Set?             │                                  │
│           ▼                 ▼                                  │
│        Yes                No                                       │
│           │                 │                                    │
│           ▼                 ▼                                  │
│  Use that URL     Check if port 4096 in use                       │
│  (manual mode)           │                                     │
│                         │                                     │
│               ┌───────────┴───────────┐                            │
│               │ In use?              │                            │
│               ▼                     ▼                            │
│            Yes                    No                                 │
│               │                     │                             │
│               ▼                     ▼                             │
│    Use existing port     Scan other ports                         │
│    (managed=false)              │                             │
│                                 │                             │
│                    ┌────────────┴────────────┐                        │
│                    │ Instance found?        │                        │
│                    ▼                       ▼                        │
│                 Yes                      No                         │
│                    │                       │                          │
│                    ▼                       ▼                         │
│           Use existing instance   Spawn managed server                 │
│           (managed=false)      via createOpencodeServer()          │
│                                     (managed=true)               │
│                                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Priority Order

1. **`OPENCODE_BASE_URL` env var** - Explicit manual mode
   - Bridge uses the specified URL
   - No lifecycle management (user controls server)
   - Best for: Users who want to run OpenCode separately

2. **Port 4096 in use** - Existing instance on default port
   - Bridge connects to `http://localhost:4096`
   - No lifecycle management (bridge won't stop it)
   - Best for: Users already running OpenCode

3. **Other ports with instances** - Discovered instances
   - Scans ports 4096, 64864-64893
   - Connects to most recently active instance
   - No lifecycle management (bridge won't stop it)
   - Best for: Users with multiple OpenCode instances

4. **No instances found** - Spawn managed server
   - Uses SDK's `createOpencodeServer()` to spawn `opencode serve`
   - **Full lifecycle management** (bridge will stop it on shutdown)
   - Tracks server URL for proper shutdown
   - Best for: Typical users who want one-command startup

## Shutdown Behavior

### Managed Server (Spawned by Bridge)
```
User presses Ctrl+C
         │
         ▼
Bridge stops WebSocket server
         │
         ▼
Bridge calls server.close() on managed OpenCode
         │
         ▼
OpenCode process terminates cleanly
         │
         ▼
Exit
```

### External Server (Existing Instance)
```
User presses Ctrl+C
         │
         ▼
Bridge stops WebSocket server
         │
         ▼
Bridge leaves OpenCode running
         │
         ▼
Exit
```

## Usage Examples

### Example 1: Managed Server (Recommended)
```bash
# Simply start the bridge - it will manage everything
$ cd packages/bridge
$ bun run dev

# Output:
# Scanning for existing OpenCode instances...
#   No existing OpenCode instances found
# No existing OpenCode found. Spawning managed server...
# ✓ Managed OpenCode server started on port 4096
#   (Bridge will manage this server lifecycle - will stop on shutdown)
# Using OpenCode at: http://localhost:4096
# ✓ OpenCode is responding
```

**On shutdown:**
```bash
# User presses Ctrl+C
# SIGINT received. Shutting down...
# Stopping bridge server...
# Stopping managed OpenCode server...
#   Managed OpenCode server stopped
# Shutdown complete. Goodbye!
```

### Example 2: Manual Mode (Env Var)
```bash
# Set env var to use specific OpenCode instance
$ export OPENCODE_BASE_URL=http://localhost:64870
$ bun run dev

# Output:
# Using OPENCODE_BASE_URL: http://localhost:64870
# Using OpenCode at: http://localhost:64870
```

**On shutdown:** (leaves your OpenCode running)

### Example 3: Existing Instance
```bash
# In terminal 1, start OpenCode manually
$ opencode serve
# OpenCode server listening on http://localhost:4096

# In terminal 2, start bridge
$ bun run dev

# Output:
# Found existing OpenCode on port 4096
#   (Bridge will connect to this instance, but will NOT stop it on shutdown)
#   (To manage OpenCode lifecycle with bridge, stop existing instance)
# Using OpenCode at: http://localhost:4096
# ✓ OpenCode is responding
```

**On shutdown:** (leaves your OpenCode running)

## Environment Variables

| Variable | Description | Behavior |
|----------|-------------|-----------|
| `BROSKI_PORT` | Bridge server port (default: 18274) | Changes WebSocket server port |
| `OPENCODE_BASE_URL` | Manual OpenCode URL | Bypasses all discovery, uses this URL exclusively |

## VS Code Extension Reference

This approach follows the same pattern as the official [VS Code OpenCode extension](https://github.com/anthropics/opencode/tree/main/extensions/vscode), which uses `createOpencodeServer()` to spawn and manage the OpenCode server process:

```typescript
// From VS Code extension
const server = await createOpencodeServer({
  port: config.get<number>('opencodeServerPort') ?? 0,
  timeout: 5000
})

// Later on extension deactivation
await server.close()
```

## Troubleshooting

### "Failed to spawn managed OpenCode server"

**Cause:** Port 4096 is already in use by another OpenCode instance

**Solution:**
```bash
# Find what's using port 4096
$ lsof -i:4096

# Kill the process if needed
$ kill <PID>

# Or, just let the bridge use the existing instance
# (It will detect it and connect automatically)
```

### "OpenCode is not responding"

**Cause:** OpenCode installed but failing to start

**Solution:**
```bash
# Check OpenCode installation
$ opencode --version

# Check OpenCode logs
$ cat ~/.local/share/opencode/log/$(date +%Y-%m-%d)*.log

# Manually test OpenCode
$ opencode serve
```

### Want to switch from managed to manual mode?

**Option 1: Stop bridge, let OpenCode run separately**
```bash
# Terminal 1: Start OpenCode manually
$ opencode serve

# Terminal 2: Stop existing bridge, start new one
# (The bridge will detect and use the existing instance)
```

**Option 2: Use env var**
```bash
# Start OpenCode on specific port
$ opencode serve --port 64870

# Tell bridge to use that port
$ export OPENCODE_BASE_URL=http://localhost:64870
$ bun run dev
```

## Benefits of Managed Mode

✅ **Single command startup** - Just `bun run dev`
✅ **Clean shutdown** - No orphaned processes
✅ **Automatic port tracking** - Bridge knows which port to use
✅ **Battle-tested** - Same pattern as VS Code extension
✅ **Graceful error handling** - Falls back to external mode if spawn fails
✅ **Backward compatible** - Still works with existing instances

## Benefits of Manual Mode

✅ **Full control** - You manage OpenCode lifecycle
✅ **Multiple instances** - Run multiple OpenCode servers
✅ **Debugging** - See OpenCode logs in separate terminal
✅ **Flexibility** - Use different OpenCode versions/configs
