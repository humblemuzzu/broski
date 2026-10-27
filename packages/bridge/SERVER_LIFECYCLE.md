# Bridge Server Lifecycle Management

Broski uses OpenCode’s official SDK to run a headless OpenCode server and proxy it to your phone.

## Default behavior (recommended)

`broski-bridge` runs in **managed mode** by default:
- Starts its **own** OpenCode server (no auto-attach, no ambiguity)
- Keeps the bridge WebSocket URL stable (phone stays connected to the bridge)
- If OpenCode dies, the bridge restarts it automatically
- On shutdown, the bridge stops OpenCode cleanly

## Modes

### 1) Managed (default)

```bash
cd packages/bridge
bun run dev
```

### 2) Manual attach (power users)

Attach to an existing OpenCode server explicitly:

```bash
OPENCODE_BASE_URL=http://127.0.0.1:4096 bun run dev
# or
bun run dev -- --opencode-url http://127.0.0.1:4096
```

In manual mode, the bridge will **not** stop OpenCode on shutdown.

### 3) Attach chooser (power users with multiple servers)

Scan common ports and prompt you to choose:

```bash
bun run dev -- --attach
```

This is still explicit (you pick), so it avoids wrong-instance surprises.

## Startup flow (managed)

1. Bridge starts OpenCode via the SDK (`createOpencode`)
2. OpenCode chooses a free port (default is `--port 0` → random port)
3. Bridge waits for readiness (`GET /path`)
4. Bridge subscribes to OpenCode global events (`GET /global/event`)
5. Bridge serves the app protocol to `broski-link`; the phone pairs with `broski-link pair`

## Shutdown behavior

### Managed

On Ctrl+C / SIGTERM:
- Abort OpenCode event stream
- Stop bridge WebSocket server (disconnect clients)
- Stop managed OpenCode process

### Manual/attach

On Ctrl+C / SIGTERM:
- Abort OpenCode event stream
- Stop bridge WebSocket server
- Leave OpenCode running (user owns lifecycle)

## Restart behavior (managed)

Bridge runs a periodic health check. If OpenCode stops responding:
- Bridge broadcasts `opencodeRunning=false` to clients
- Bridge restarts OpenCode and re-subscribes to events
- Bridge broadcasts `opencodeRunning=true` again

The phone stays connected to the bridge the whole time.

