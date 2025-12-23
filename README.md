# Broski

Control OpenCode (and optionally Claude Code) from your phone. Your computer runs the agent; the phone is just a remote UI.

## Status

The MVP is defined in `docs/mvp/`. That folder is the current source of truth.

## MVP Architecture (Short)

```
Phone (PWA) <-> broski-bridge (Node) <-> OpenCode (localhost)
```

Tailscale is the optional remote path for when you are away from home.

## Documentation

- `docs/mvp/README.md` - start here
- `docs/mvp/REQUIREMENTS.md` - scope and constraints
- `docs/mvp/IMPLEMENTATION_GUIDE.md` - step-by-step build
- `docs/mvp/PROJECT_STRUCTURE.md` - file layout
- `docs/legacy/` - archived docs (not active)

## Quick Start (once built)

On your Mac:

```bash
npx broski-bridge
```

On your phone:

1. Open the web app
2. Scan the QR code
3. Start coding
