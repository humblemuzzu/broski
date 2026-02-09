# Native PTY Plan — Making Terminal Independent from OpenCode

> **Author**: AI Agent (Claude Code)  
> **Date**: February 10, 2026  
> **Status**: Plan — ready to implement  
> **Priority**: High — blocks CC/CX-only users from using terminal

---

## Table of Contents

1. [The Problem](#the-problem)
2. [Current Architecture (How PTY Works Today)](#current-architecture)
3. [Why OpenCode PTY Can't Serve All Agents](#why-opencode-pty-cant-serve-all-agents)
4. [The Solution: Native PTY via `forkpty()` C Helper](#the-solution)
5. [Research & Proof of Concept](#research--proof-of-concept)
6. [Architecture: PTY Manager (Hybrid Routing)](#architecture-pty-manager)
7. [Implementation: The C Helper Library](#implementation-c-helper)
8. [Implementation: TypeScript FFI Wrapper](#implementation-typescript-ffi-wrapper)
9. [Implementation: PTY Manager (Router)](#implementation-pty-manager)
10. [Implementation: Server.ts Integration](#implementation-serversts-integration)
11. [Implementation: Build Script Changes](#implementation-build-script)
12. [Security Considerations](#security)
13. [File Manifest (All New/Modified Files)](#file-manifest)
14. [Step-by-Step Implementation Order](#step-by-step)
15. [Testing Checklist](#testing)

---

## The Problem

### What breaks today

When a user **only has Claude Code or Codex installed** (no OpenCode CLI on their machine), the bridge starts fine, chat works fine, but **Terminal is completely broken**.

```
User opens Terminal tab in Broski app
  → Flutter sends 'list_pty' message
  → Bridge handler calls requireOpenCode()
  → opencode is null (OC was never bootstrapped)
  → THROWS: "OpenCode backend is not available on this machine"
  → User sees "Failed to load terminals" error
```

### Why OpenCode might not be running

The bridge startup in `index.ts`:

```typescript
// index.ts line ~1182
if (!isOpencodeCliAvailable(cli.verbose)) {
  console.log('OpenCode CLI not found in PATH; skipping OpenCode bootstrap.')
} else {
  bootstrap = await bootstrapManagedOpenCode(...)
}
```

`isOpencodeCliAvailable()` runs `opencode --version`. If the user never installed OpenCode:

```
$ which opencode
opencode not found
```

→ `bootstrap = null` → `opencode = null` → every `requireOpenCode()` call throws.

### The 69 broken handlers

Every one of these calls throws when OC is null:

| Feature | Handlers | Impact |
|---------|----------|--------|
| **PTY Terminal** | `list_pty`, `create_pty`, `get_pty`, `update_pty`, `delete_pty`, `pty_connect`, `pty_resize` | **Terminal completely broken** |
| File search | `find_files`, `find_text`, `find_symbols` | Search broken |
| MCP management | `get_mcp_status`, `add_mcp`, `connect_mcp`, `disconnect_mcp`, `get_mcp_resources` | MCP broken |
| Worktrees | `list_worktrees`, `create_worktree`, `reset_worktree`, `delete_worktree` | Worktrees broken |
| Session features | `get_session_status`, `get_session_context`, `get_todos`, etc. | OC-specific (OK) |

The PTY terminal is the only one that's **a core Broski feature** and should work regardless of agent. The rest are OpenCode-specific SDK features (fine to require OC for those).

### Who's affected

- User who installs **only Claude Code** (`claude` CLI) → No OC → No terminal
- User who installs **only Codex** (`codex` CLI) → No OC → No terminal
- User who has **all three** → OC is running → Terminal works (current state)

---

## Current Architecture

### How PTY works today (all through OpenCode server)

```
Flutter App                    Bridge (server.ts)                 OpenCode Server
─────────                      ──────────────────                 ───────────────
                                                                  (localhost:4096)
Terminal Screen
  ├─ list_pty ──────────────→ requireOpenCode() ──→ oc.listPty() ──→ GET /pty
  ├─ create_pty ────────────→ requireOpenCode() ──→ oc.createPty() → POST /pty
  ├─ pty_connect ───────────→ requireOpenCode() ──→ WebSocket ─────→ WS /pty/{id}/connect
  │    (bridge proxies WS)      ↕ bidirectional                      ↕ bidirectional
  ├─ pty_input ─────────────→ ptyConnections.get(id).send(data) ───→ WS send
  ├─ pty_resize ────────────→ requireOpenCode() ──→ oc.updatePty() → POST /pty/{id}
  └─ pty_disconnect ────────→ close WS connection ─────────────────→ WS close
```

### Key insight: OC PTY is just HTTP/WS API calls

OpenCode's PTY is not magic. Under the hood, the OC server:
1. Calls `forkpty()` to create a pseudo-terminal
2. Runs the shell inside it
3. Exposes the master FD over WebSocket at `/pty/{id}/connect`
4. Exposes CRUD over REST (`GET/POST/DELETE /pty/{id}`)

We can do the same thing directly in the bridge.

---

## Why OpenCode PTY Can't Serve All Agents

**"Can't we just require OpenCode to always be installed?"**

No, because:
1. Broski supports 3 backends: OpenCode, Claude Code, Codex
2. Users choose which AI to install — many will only install one
3. Making terminal depend on a specific AI backend is bad UX and a support nightmare
4. The bridge itself is agent-agnostic by design — terminal should be too

**"Can't we bundle OpenCode in our binary?"**

No, because:
1. OpenCode is a separate project with its own binary (`opencode` CLI)
2. The bridge binary is ~90MB; bundling another CLI would double it
3. Licensing: OpenCode is open-source but has its own release cycle
4. The bridge calls `createOpencode()` from the SDK which spawns a child process — it needs the actual binary

**The right answer: build native PTY into the bridge itself.**

---

## The Solution

### Two-layer PTY system

```
PTY request from Flutter
         │
         ▼
┌─────────────────────┐
│    PTY Manager       │  packages/bridge/src/pty/manager.ts
│  (routes requests)   │
└────────┬────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────┐
│ OC PTY │ │Native PTY│
│(SDK)   │ │(forkpty) │
└────────┘ └──────────┘
 Used when    Used when
 OC running   OC is null
```

- **Layer 1 (OpenCode PTY)**: When OpenCode is available, use its PTY API exactly as today. Zero changes to existing behavior.
- **Layer 2 (Native PTY)**: When OpenCode is NOT available, use our own PTY implementation via `forkpty()` C helper + Bun FFI.

This means:
- Users with OC installed: same experience as today
- Users without OC: terminal still works via native PTY
- Zero regression risk

---

## Research & Proof of Concept

### What we tested and what works

**Test 1: Can Bun FFI call PTY system functions?** ✅

```typescript
import { dlopen, FFIType, ptr, CString } from 'bun:ffi';
const lib = dlopen('/usr/lib/libSystem.B.dylib', {
  posix_openpt: { returns: FFIType.int, args: [FFIType.int] },
  grantpt: { returns: FFIType.int, args: [FFIType.int] },
  unlockpt: { returns: FFIType.int, args: [FFIType.int] },
  ptsname: { returns: FFIType.ptr, args: [FFIType.int] },
});
const masterFd = lib.symbols.posix_openpt(2); // O_RDWR
// Result: OK (fd=4)
```

✅ `posix_openpt`, `grantpt`, `unlockpt`, `ptsname` all work via FFI.

**Test 2: Can Bun.spawn use a PTY slave for stdio?** ❌

```typescript
const proc = Bun.spawn(['/bin/bash'], {
  stdin: slaveFd, stdout: slaveFd, stderr: slaveFd,
});
```

Result: Shell spawns but `stty size` returns `0 0`. `isatty()` returns false.
**Why**: `Bun.spawn` doesn't call `setsid()` or `TIOCSCTTY`. Without these, the slave PTY is just a dumb pipe, not a controlling terminal.

**Test 3: Can `ioctl(TIOCSWINSZ)` be called via FFI for resize?** ❌

```typescript
const lib = dlopen(libPath, {
  ioctl: { returns: FFIType.int, args: [FFIType.int, FFIType.u64, FFIType.ptr] },
});
lib.symbols.ioctl(masterFd, TIOCSWINSZ, ptr(winsize)); // FAILS
```

Result: Returns -1, errno=5 (EIO) after spawn. Returns seemingly OK before spawn but values are garbage.
**Why**: `ioctl` is a **variadic C function** (`int ioctl(int, unsigned long, ...)`). On ARM64 (Apple Silicon), variadic and non-variadic calling conventions differ — variadic args go on the stack, not in registers. Bun's FFI assumes non-variadic, so the pointer arg lands in the wrong place.

**Test 4: Compiled C helper with `forkpty()`?** ✅✅✅

```c
// 60-line C file compiled to .dylib
pid_t pid = forkpty(&master, slave_name, NULL, &ws);
if (pid == 0) { /* child: exec shell */ }
// parent: read/write/resize master fd
```

```
$ bun run test.ts
masterFd=4, pid=63823, slave=/dev/ttys004
stty size: 25 80           ✅ Initial size works
Resize 50x150: ✅ SUCCESS
stty size: 50 150          ✅ Resize works  
Resize 24x80: ✅ SUCCESS
stty size: 24 80           ✅ Multiple resizes work
```

**This is the winner.** `forkpty()` handles everything:
- `setsid()` in child ✅
- `TIOCSCTTY` (controlling terminal) ✅
- `dup2` stdio to slave ✅
- Initial terminal size ✅
- `ioctl(TIOCSWINSZ)` for resize (non-variadic in our C code) ✅
- Child gets a real PTY (`isatty()=true`, colors, vim, htop all work) ✅

### Why alternatives don't work

| Approach | Problem |
|----------|---------|
| `Bun.spawn` with pipe stdio | Not a PTY. `isatty()=false`. No colors, no vim, no line editing |
| `Bun.spawn` with PTY FDs | No `setsid()`/`TIOCSCTTY`. Terminal size 0x0. Resize impossible |
| FFI `ioctl` directly | Variadic function — ARM64 calling convention breaks it |
| `node-pty` npm package | Native C++ addon. Can't bundle in compiled Bun binary |
| `script` command wrapper | No resize support. Can't `ioctl` the inner PTY |
| `forkpty()` via FFI | Calls `fork()` inside FFI — dangerous in multi-threaded Bun process. Child is zombie copy of Bun with dead threads |
| **Compiled C helper + FFI** | **✅ Everything works. fork/exec happens in C, safe and correct** |

---

## Architecture: PTY Manager

### The routing logic

```typescript
// packages/bridge/src/pty/manager.ts

class PtyManager {
  private opencode: OpenCodeConnector | null;
  private nativePty: NativePtyProvider;
  
  // Route to OC when available, native otherwise
  get provider(): PtyProvider {
    if (this.opencode) return this.opencodePty;
    return this.nativePty;
  }
  
  async createPty(opts): Promise<PtySession> {
    return this.provider.createPty(opts);
  }
  
  async listPty(projectPath?): Promise<PtySession[]> {
    return this.provider.listPty(projectPath);
  }
  
  // ... etc
}
```

### PTY Provider interface

Both OpenCode and Native PTY implement the same interface:

```typescript
// packages/bridge/src/pty/types.ts

interface PtyProvider {
  listPty(projectPath?: string): Promise<PtySession[]>;
  createPty(opts: CreatePtyOpts): Promise<PtySession | null>;
  getPty(id: string): Promise<PtySession | null>;
  deletePty(id: string): Promise<boolean>;
  resize(id: string, rows: number, cols: number): Promise<void>;
  
  // I/O — different model:
  // OC: WebSocket URL to connect to
  // Native: direct read/write on master FD
  connectPty(id: string): PtyConnection;
}

interface PtyConnection {
  onData: (callback: (data: string) => void) => void;
  write: (data: string) => void;
  resize: (rows: number, cols: number) => void;
  disconnect: () => void;
}
```

---

## Implementation: The C Helper Library

### File: `packages/bridge/native/pty/pty_helper.c`

This is the complete C file (~100 lines). It compiles to `libbroski_pty.dylib` (macOS) or `libbroski_pty.so` (Linux).

```c
/*
 * Broski PTY Helper — Native pseudo-terminal for the bridge binary.
 *
 * Provides forkpty()-based PTY creation with proper setsid/TIOCSCTTY
 * and non-variadic wrappers for ioctl (ARM64-safe).
 *
 * Compiled per-platform and shipped alongside the broski binary.
 * Loaded via Bun FFI at runtime.
 */

#if defined(__APPLE__)
#include <util.h>          /* forkpty on macOS */
#else
#include <pty.h>           /* forkpty on Linux */
#endif

#include <sys/ioctl.h>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
#include <errno.h>
#include <signal.h>
#include <stdlib.h>
#include <termios.h>

/* ── PTY Creation ────────────────────────────────────────────────── */

/*
 * Create a new PTY session with forkpty().
 * 
 * forkpty() does ALL the hard work:
 *   - posix_openpt + grantpt + unlockpt (creates PTY pair)
 *   - fork() (creates child process)
 *   - In child: setsid(), open slave, TIOCSCTTY, dup2 to 0/1/2
 *   - Returns master FD to parent, 0 to child
 *
 * Returns: master FD (>= 0) on success, -1 on failure.
 * Sets *pid_out to child PID, *slave_path_out to slave device path.
 */
int pty_create(
    int* pid_out,
    char* slave_path_out,
    int slave_path_len,
    unsigned short initial_rows,
    unsigned short initial_cols,
    const char* shell,       /* e.g. "/bin/zsh" or NULL for $SHELL */
    const char* cwd,         /* working directory or NULL */
    const char* term_env     /* TERM value or NULL for "xterm-256color" */
) {
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_row = initial_rows > 0 ? initial_rows : 24;
    ws.ws_col = initial_cols > 0 ? initial_cols : 80;

    char slave_name[256];
    int master_fd;
    pid_t pid = forkpty(&master_fd, slave_name, NULL, &ws);

    if (pid < 0) {
        /* forkpty failed */
        return -1;
    }

    if (pid == 0) {
        /* ── Child process ────────────────────────────────────────── */

        /* Change to requested working directory */
        if (cwd && cwd[0] != '\0') {
            if (chdir(cwd) != 0) {
                /* Fall back to home directory */
                const char* home = getenv("HOME");
                if (home) chdir(home);
            }
        }

        /* Set TERM environment variable */
        setenv("TERM", (term_env && term_env[0]) ? term_env : "xterm-256color", 1);

        /* Reset signal handlers to defaults (inherited from Bun) */
        signal(SIGCHLD, SIG_DFL);
        signal(SIGHUP,  SIG_DFL);
        signal(SIGINT,  SIG_DFL);
        signal(SIGQUIT, SIG_DFL);
        signal(SIGTERM, SIG_DFL);
        signal(SIGALRM, SIG_DFL);
        signal(SIGPIPE, SIG_DFL);

        /* Determine shell */
        const char* sh = (shell && shell[0]) ? shell : getenv("SHELL");
        if (!sh || !sh[0]) sh = "/bin/sh";

        /* Construct login shell name (e.g. "-zsh", "-bash") */
        char login_name[256];
        const char* base = strrchr(sh, '/');
        snprintf(login_name, sizeof(login_name), "-%s", base ? base + 1 : sh);

        /* Replace child process with shell */
        execlp(sh, login_name, (char*)NULL);

        /* If exec failed, exit */
        _exit(127);
    }

    /* ── Parent process ───────────────────────────────────────── */
    *pid_out = (int)pid;
    if (slave_path_out && slave_path_len > 0) {
        strncpy(slave_path_out, slave_name, slave_path_len - 1);
        slave_path_out[slave_path_len - 1] = '\0';
    }

    /* Set master FD to non-blocking for async reads */
    int flags = fcntl(master_fd, F_GETFL, 0);
    if (flags >= 0) {
        fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);
    }

    return master_fd;
}

/* ── Resize (ARM64-safe, non-variadic) ───────────────────────── */

int pty_resize(int master_fd, unsigned short rows, unsigned short cols) {
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_row = rows;
    ws.ws_col = cols;
    return ioctl(master_fd, TIOCSWINSZ, &ws);
}

/* ── I/O ─────────────────────────────────────────────────────── */

int pty_read(int fd, void* buf, int len) {
    return (int)read(fd, buf, (size_t)len);
}

int pty_write(int fd, const void* data, int len) {
    return (int)write(fd, data, (size_t)len);
}

/* ── Lifecycle ───────────────────────────────────────────────── */

int pty_close(int fd) {
    return close(fd);
}

int pty_kill(int pid, int sig) {
    return kill((pid_t)pid, sig);
}

/*
 * Wait for child exit (non-blocking).
 * Returns: exit status if exited, -1 if still running, -2 on error.
 */
int pty_waitpid(int pid) {
    int status;
    pid_t result = waitpid((pid_t)pid, &status, WNOHANG);
    if (result == 0) return -1;          /* still running */
    if (result < 0) return -2;           /* error */
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return -2;
}

/* ── Error reporting ─────────────────────────────────────────── */

int pty_errno(void) {
    return errno;
}
```

### Why this is safe

1. **`fork()` happens inside C, not in Bun's FFI** — `forkpty()` is a single C function call. The fork+exec happens atomically from Bun's perspective.

2. **Child immediately calls `execlp()`** — POSIX guarantees fork+exec is safe in multi-threaded processes. The child process image is immediately replaced with the shell. No risk of deadlocked Bun threads in the child.

3. **Signal handlers are reset** — Bun installs custom signal handlers. We reset them to `SIG_DFL` in the child before exec.

4. **Non-blocking master** — The parent reads from the master FD in a polling loop. No blocking calls that could stall the Bun event loop.

### Platform differences

| | macOS | Linux |
|---|---|---|
| `forkpty()` header | `<util.h>` | `<pty.h>` |
| Library | `libSystem.B.dylib` (always present) | `libc.so.6` + `libutil.so` |
| Compile | `cc -shared -o libbroski_pty.dylib` | `cc -shared -fPIC -o libbroski_pty.so -lutil` |
| TIOCSWINSZ value | `0x80087467` | `0x5414` |
| Handled by | Our C code (uses `<sys/ioctl.h>` which defines the right value per platform) | Same |

---

## Implementation: TypeScript FFI Wrapper

### File: `packages/bridge/src/pty/native-pty.ts`

```typescript
/**
 * Native PTY implementation using forkpty() via Bun FFI.
 * 
 * Loads libbroski_pty.{dylib,so} and provides a TypeScript API
 * for creating/managing pseudo-terminal sessions.
 */
import { dlopen, FFIType, ptr } from 'bun:ffi'
import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { isCompiledBinary } from '../platform'

// ── Types ──────────────────────────────────────────────────────

export interface NativePtySession {
  id: string
  pid: number
  masterFd: number
  slavePath: string
  title: string
  command: string
  cwd: string
  rows: number
  cols: number
  createdAt: number
}

export interface NativePtyConnection {
  onData: (callback: (data: string) => void) => void
  write: (data: string) => void
  resize: (rows: number, cols: number) => void
  disconnect: () => void
}

// ── Library Loading ────────────────────────────────────────────

const LIB_SYMBOLS = {
  pty_create: {
    returns: FFIType.int,
    args: [
      FFIType.ptr,   // pid_out
      FFIType.ptr,   // slave_path_out
      FFIType.int,   // slave_path_len
      FFIType.u16,   // initial_rows
      FFIType.u16,   // initial_cols
      FFIType.ptr,   // shell
      FFIType.ptr,   // cwd
      FFIType.ptr,   // term_env
    ],
  },
  pty_resize: { returns: FFIType.int, args: [FFIType.int, FFIType.u16, FFIType.u16] },
  pty_read:   { returns: FFIType.int, args: [FFIType.int, FFIType.ptr, FFIType.int] },
  pty_write:  { returns: FFIType.int, args: [FFIType.int, FFIType.ptr, FFIType.int] },
  pty_close:  { returns: FFIType.int, args: [FFIType.int] },
  pty_kill:   { returns: FFIType.int, args: [FFIType.int, FFIType.int] },
  pty_waitpid: { returns: FFIType.int, args: [FFIType.int] },
  pty_errno:  { returns: FFIType.int, args: [] },
} as const

function findLibrary(): string | null {
  const ext = process.platform === 'darwin' ? 'dylib' : 'so'
  const name = `libbroski_pty.${ext}`
  
  // 1. Same directory as the binary (production)
  const binaryDir = dirname(process.execPath)
  const prod = resolve(binaryDir, name)
  if (existsSync(prod)) return prod
  
  // 2. dist/ directory (dev builds)
  const dist = resolve(import.meta.dir, '..', '..', 'dist', name)
  if (existsSync(dist)) return dist
  
  // 3. native/pty/ build output (dev)
  const dev = resolve(import.meta.dir, '..', '..', 'native', 'pty', name)
  if (existsSync(dev)) return dev
  
  return null
}

let _lib: ReturnType<typeof dlopen<typeof LIB_SYMBOLS>> | null = null

function getLib() {
  if (_lib) return _lib
  const path = findLibrary()
  if (!path) {
    throw new Error(
      'Native PTY library not found (libbroski_pty). ' +
      'Terminal requires either OpenCode or the native PTY helper.'
    )
  }
  _lib = dlopen(path, LIB_SYMBOLS)
  return _lib
}

// Check if native PTY is available without throwing
export function isNativePtyAvailable(): boolean {
  try {
    return findLibrary() !== null
  } catch {
    return false
  }
}

// ── Session Management ─────────────────────────────────────────

const sessions = new Map<string, NativePtySession>()
const SIGWINCH = 28
const SIGTERM = 15
const SIGKILL = 9
const EAGAIN = process.platform === 'darwin' ? 35 : 11

export function nativeListPty(): NativePtySession[] {
  // Clean up dead sessions
  for (const [id, session] of sessions) {
    const lib = getLib()
    const exit = lib.symbols.pty_waitpid(session.pid)
    if (exit !== -1) {
      // Process exited
      lib.symbols.pty_close(session.masterFd)
      sessions.delete(id)
    }
  }
  return Array.from(sessions.values())
}

export function nativeCreatePty(opts: {
  command?: string
  cwd?: string
  title?: string
  rows?: number
  cols?: number
  env?: Record<string, string>
}): NativePtySession | null {
  const lib = getLib()
  const id = `native-pty-${randomBytes(8).toString('hex')}`
  
  const pidBuf = new Int32Array(1)
  const pathBuf = Buffer.alloc(256)
  const shell = opts.command
    ? Buffer.from(opts.command + '\0')
    : Buffer.from('\0') // NULL → uses $SHELL
  const cwd = opts.cwd
    ? Buffer.from(opts.cwd + '\0')
    : Buffer.from('\0')
  const term = Buffer.from('xterm-256color\0')
  
  const rows = opts.rows ?? 24
  const cols = opts.cols ?? 80
  
  const masterFd = lib.symbols.pty_create(
    ptr(pidBuf), ptr(pathBuf), 256,
    rows, cols,
    ptr(shell), ptr(cwd), ptr(term),
  )
  
  if (masterFd < 0) {
    console.error(`[NativePTY] pty_create failed (errno=${lib.symbols.pty_errno()})`)
    return null
  }
  
  const session: NativePtySession = {
    id,
    pid: pidBuf[0],
    masterFd,
    slavePath: pathBuf.toString('utf8').replace(/\0.*/, ''),
    title: opts.title ?? opts.command ?? 'Terminal',
    command: opts.command ?? process.env.SHELL ?? '/bin/sh',
    cwd: opts.cwd ?? process.env.HOME ?? '/',
    rows,
    cols,
    createdAt: Date.now(),
  }
  
  sessions.set(id, session)
  return session
}

export function nativeGetPty(id: string): NativePtySession | null {
  return sessions.get(id) ?? null
}

export function nativeDeletePty(id: string): boolean {
  const session = sessions.get(id)
  if (!session) return true
  
  const lib = getLib()
  lib.symbols.pty_kill(session.pid, SIGTERM)
  
  // Give it 100ms to exit gracefully, then force kill
  setTimeout(() => {
    const exit = lib.symbols.pty_waitpid(session.pid)
    if (exit === -1) {
      lib.symbols.pty_kill(session.pid, SIGKILL)
    }
    lib.symbols.pty_close(session.masterFd)
    sessions.delete(id)
  }, 100)
  
  return true
}

export function nativeResizePty(id: string, rows: number, cols: number): boolean {
  const session = sessions.get(id)
  if (!session) return false
  
  const lib = getLib()
  const ret = lib.symbols.pty_resize(session.masterFd, rows, cols)
  if (ret === 0) {
    // Send SIGWINCH to notify the shell
    lib.symbols.pty_kill(session.pid, SIGWINCH)
    session.rows = rows
    session.cols = cols
    return true
  }
  return false
}

// ── I/O Connection ─────────────────────────────────────────────

export function nativeConnectPty(id: string): NativePtyConnection | null {
  const session = sessions.get(id)
  if (!session) return null
  
  const lib = getLib()
  let running = true
  let dataCallback: ((data: string) => void) | null = null
  const readBuf = Buffer.alloc(16384)
  
  // Polling loop for reading output
  const poll = async () => {
    while (running) {
      const n = lib.symbols.pty_read(session.masterFd, ptr(readBuf), readBuf.length)
      if (n > 0) {
        const text = readBuf.subarray(0, n).toString('utf8')
        dataCallback?.(text)
      } else if (n < 0) {
        const errno = lib.symbols.pty_errno()
        if (errno === EAGAIN) {
          // No data available, sleep briefly
          await Bun.sleep(8) // ~120fps max polling rate
        } else {
          // Real error (EIO = child exited)
          running = false
          break
        }
      } else {
        // EOF
        running = false
        break
      }
    }
  }
  
  // Start polling
  void poll()
  
  return {
    onData: (cb) => { dataCallback = cb },
    write: (data) => {
      if (!running) return
      const buf = Buffer.from(data, 'utf8')
      lib.symbols.pty_write(session.masterFd, ptr(buf), buf.length)
    },
    resize: (rows, cols) => {
      nativeResizePty(id, rows, cols)
    },
    disconnect: () => {
      running = false
    },
  }
}
```

### Poll rate optimization

The `Bun.sleep(8)` in the read loop means:
- **When active**: reads as fast as data arrives (~120fps equivalent)
- **When idle**: sleeps 8ms between polls (~125 checks/second)
- **CPU impact**: negligible — `read()` on a non-blocking FD is essentially free when there's no data

For comparison, OpenCode's PTY uses WebSocket which also polls internally.

---

## Implementation: PTY Manager

### File: `packages/bridge/src/pty/manager.ts`

The manager routes PTY operations to either OpenCode or native PTY:

```typescript
/**
 * PTY Manager — routes terminal operations to the best available backend.
 * 
 * Priority:
 *   1. OpenCode PTY (when OC is running) — full-featured, battle-tested
 *   2. Native PTY (forkpty helper) — works without any SDK
 */
import type { OpenCodeConnector } from '../connectors/opencode'
import type { PtySession } from '../types'
import {
  isNativePtyAvailable,
  nativeListPty,
  nativeCreatePty,
  nativeGetPty,
  nativeDeletePty,
  nativeResizePty,
  nativeConnectPty,
  type NativePtySession,
  type NativePtyConnection,
} from './native-pty'

export type PtyBackend = 'opencode' | 'native'

export class PtyManager {
  constructor(private opencode: OpenCodeConnector | null) {}
  
  /** Which backend is active */
  get backend(): PtyBackend {
    return this.opencode ? 'opencode' : 'native'
  }
  
  get available(): boolean {
    return !!this.opencode || isNativePtyAvailable()
  }
  
  updateOpenCode(oc: OpenCodeConnector | null) {
    this.opencode = oc
  }

  // ── OpenCode delegates (same as current code) ──────────────
  
  async listPty(projectPath?: string): Promise<PtySession[]> {
    if (this.opencode) {
      return this.opencode.listPty(projectPath)
    }
    // Native: map to PtySession shape
    return nativeListPty().map(mapNativeToWire)
  }
  
  async createPty(opts: {
    command?: string
    args?: string[]
    cwd?: string
    title?: string
    env?: Record<string, string>
    rows?: number
    cols?: number
    projectPath?: string
  }): Promise<PtySession | null> {
    if (this.opencode) {
      return this.opencode.createPty(
        opts.command, opts.args, opts.cwd,
        opts.title, opts.env, opts.projectPath,
      )
    }
    const session = nativeCreatePty(opts)
    return session ? mapNativeToWire(session) : null
  }
  
  async getPty(id: string, projectPath?: string): Promise<PtySession | null> {
    if (this.opencode) return this.opencode.getPty(id, projectPath)
    const s = nativeGetPty(id)
    return s ? mapNativeToWire(s) : null
  }
  
  async deletePty(id: string, projectPath?: string): Promise<boolean> {
    if (this.opencode) return this.opencode.deletePty(id, projectPath)
    return nativeDeletePty(id)
  }
  
  async resize(id: string, rows: number, cols: number, projectPath?: string): Promise<void> {
    if (this.opencode) {
      await this.opencode.updatePty(id, undefined, rows, cols, projectPath)
      return
    }
    nativeResizePty(id, rows, cols)
  }

  /** 
   * Get WebSocket URL for OC PTY, or null if using native PTY.
   * When null, caller should use connectNative() instead.
   */
  getWebSocketUrl(id: string, projectPath?: string): string | null {
    if (this.opencode) {
      return this.opencode.getPtyWebSocketUrl(id, projectPath)
    }
    return null // Native PTY doesn't use WebSocket
  }
  
  /**
   * Connect to a native PTY session for direct I/O.
   * Returns null if the session is managed by OpenCode (use WebSocket instead).
   */
  connectNative(id: string): NativePtyConnection | null {
    if (this.opencode) return null
    return nativeConnectPty(id)
  }
}

function mapNativeToWire(s: NativePtySession): PtySession {
  return {
    id: s.id,
    title: s.title,
    command: s.command,
    cwd: s.cwd,
    pid: s.pid,
    running: true,
    createdAt: new Date(s.createdAt).toISOString(),
  }
}
```

---

## Implementation: server.ts Integration

### Changes to server.ts

Replace all PTY `requireOpenCode()` calls with the PTY manager.

**In `createBridgeServer()`:**

```typescript
// Near the top, after opencode is destructured:
import { PtyManager } from './pty/manager'

const ptyManager = new PtyManager(opencode)
```

**Replace PTY handlers (example for `create_pty`):**

```typescript
// BEFORE:
case 'create_pty': {
  const oc = requireOpenCode()  // ← THROWS when OC is null
  const pty = await oc.createPty(...)
  // ...
}

// AFTER:
case 'create_pty': {
  if (!ptyManager.available) {
    reply({ type: 'error', message: 'Terminal not available (install OpenCode or ensure native PTY library is present)' })
    break
  }
  const pty = await ptyManager.createPty({
    command: message.command,
    args: message.args,
    cwd: message.cwd,
    title: message.title,
    env: (message as any).env,
    projectPath: message.projectPath,
  })
  // ... rest same
}
```

**The `pty_connect` handler needs the biggest change** because it currently opens a WebSocket to OC. For native PTY, it reads from the master FD directly:

```typescript
case 'pty_connect': {
  const ptyId = message.ptyId
  getPtyListeners(ptyId).add(ws)
  
  const wsUrl = ptyManager.getWebSocketUrl(ptyId, message.projectPath)
  
  if (wsUrl) {
    // ── OpenCode path (existing WebSocket proxy) ──
    // ... keep existing WebSocket connection code exactly as-is ...
  } else {
    // ── Native PTY path (direct master FD I/O) ──
    const conn = ptyManager.connectNative(ptyId)
    if (!conn) {
      reply({ type: 'error', message: 'PTY session not found' })
      break
    }
    
    nativePtyConnections.set(ptyId, conn)
    
    conn.onData((data) => {
      const health = ensurePtyHealth(ptyId)
      health.lastOutputTime = Date.now()
      health.bytesOut += data.length
      
      const buf = ensurePtyBuffer(ptyId)
      buf.buffer += data
      if (!buf.timer) {
        buf.timer = setTimeout(() => flushPtyOutput(ptyId), 16)
      }
      if (buf.buffer.length >= 256 * 1024) {
        flushPtyOutput(ptyId)
      }
    })
    
    reply({ type: 'pty_connected', data: { ptyId } })
  }
  break
}
```

**`pty_input` handler:**

```typescript
case 'pty_input': {
  const data = typeof message.data === 'string' ? message.data : ''
  if (data.length > 10000) {
    send(ws, { type: 'pty_error', ptyId: message.ptyId, error: 'Input too large' })
    break
  }
  
  // Try OpenCode WebSocket first (existing code)
  const ptyWs = ptyConnections.get(message.ptyId)
  if (ptyWs && ptyWs.readyState === WebSocket.OPEN) {
    ptyWs.send(data)
    break
  }
  
  // Try native PTY connection
  const nativeConn = nativePtyConnections.get(message.ptyId)
  if (nativeConn) {
    nativeConn.write(data)
    break
  }
  
  send(ws, { type: 'pty_error', ptyId: message.ptyId, error: 'PTY is not connected' })
  break
}
```

**`pty_resize` handler:**

```typescript
case 'pty_resize': {
  await ptyManager.resize(message.ptyId, message.rows, message.cols, message.projectPath)
  break
}
```

---

## Implementation: Build Script

### File changes to `packages/bridge/scripts/build.sh`

Add a new section that compiles the C helper per platform:

```bash
# ──────────────────────────────────────────────
# Build native PTY helper library
# ──────────────────────────────────────────────

echo "  Building native PTY helper..."

PTY_SRC="native/pty/pty_helper.c"

build_pty_helper() {
  local PLATFORM="$1"
  local OUTPUT=""
  
  case "$PLATFORM" in
    darwin-arm64)
      OUTPUT="${DIST}/libbroski_pty.dylib"
      cc -shared -arch arm64 -o "$OUTPUT" "$PTY_SRC" 2>/dev/null
      ;;
    darwin-x64)
      OUTPUT="${DIST}/libbroski_pty.dylib"
      cc -shared -arch x86_64 -o "$OUTPUT" "$PTY_SRC" 2>/dev/null
      ;;
    linux-x64)
      OUTPUT="${DIST}/libbroski_pty.so"
      cc -shared -fPIC -o "$OUTPUT" "$PTY_SRC" -lutil 2>/dev/null
      ;;
    linux-arm64)
      OUTPUT="${DIST}/libbroski_pty.so"
      cc -shared -fPIC -o "$OUTPUT" "$PTY_SRC" -lutil 2>/dev/null
      ;;
    windows-x64)
      echo "    PTY helper not supported on Windows (ConPTY is a future feature)"
      return
      ;;
  esac
  
  if [ -f "$OUTPUT" ]; then
    echo "    ✓ $(basename "$OUTPUT") built for ${PLATFORM}"
  else
    echo "    ⚠ PTY helper build failed for ${PLATFORM} (terminal will require OpenCode)"
  fi
}
```

Add to the build loop:
```bash
  build_target "$BUN_TARGET" "$OUTPUT" "$PLATFORM"
  build_pty_helper "$PLATFORM"   # ← ADD THIS LINE
```

### File structure after build

```
dist/
  broski-darwin-arm64           # Main binary
  broski-darwin-arm64.sig       # Ed25519 signature
  libbroski_license.dylib       # License verification (existing)
  libbroski_pty.dylib           # PTY helper (NEW)
```

### Install/distribution

The install script already copies the binary. It needs to also copy the PTY helper:

In `platform.ts` `installDaemon()` or wherever the binary is deployed, ensure `libbroski_pty.{dylib,so}` is in the same directory as the binary.

---

## Security

### Threat model

The PTY helper is a shared library loaded via FFI. It runs in the bridge process (same user, same permissions). The security considerations:

1. **Library integrity**: Same as `libbroski_license` — the helper should be hash-verified. Add its hash to the integrity check in `build.sh` (same pattern as the license library hash baking).

2. **Input validation**: All FFI inputs are validated in TypeScript before calling C:
   - `rows`/`cols` clamped to sane ranges (1-500)
   - `command` string length limited
   - `cwd` validated via `getSecurePath()` (existing function)
   - `data` (pty_input) limited to 10KB (existing check)

3. **Path traversal**: The `cwd` parameter should go through the existing `getSecurePath()` validation before being passed to the C helper. This prevents creating terminals in unauthorized directories.

4. **Resource limits**: Cap the number of concurrent native PTY sessions (e.g., 20). Each session holds a master FD and a child process. Without limits, a malicious client could exhaust FDs or fork-bomb.

5. **Cleanup on shutdown**: The bridge shutdown handler must kill all native PTY child processes and close master FDs. Otherwise orphan shells survive bridge restart.

### Hash baking (same pattern as license lib)

In `build.sh`, add after the native lib hash baking section:

```bash
# Hash the PTY helper too
for binary in "$DIST"/broski-*; do
  case "$binary" in *.sig|*.dylib|*.so|*.dll) continue ;; esac
  case "$binary" in
    *darwin*)  PTY_LIB="${DIST}/libbroski_pty.dylib" ;;
    *linux*)   PTY_LIB="${DIST}/libbroski_pty.so" ;;
    *)         PTY_LIB="" ;;
  esac
  if [ -n "$PTY_LIB" ] && [ -f "$PTY_LIB" ]; then
    PTY_HASH=$(shasum -a 256 "$PTY_LIB" | awk '{print $1}')
    perl -pi -e "s/%%PTY_LIB_HASH_PLACEHOLDER%%/${PTY_HASH}/g" "$binary"
    echo "    ✓ PTY hash baked into $(basename "$binary")"
  fi
done
```

In `native-pty.ts`, verify the hash before loading:

```typescript
function verifyLibraryHash(libPath: string): boolean {
  if (!isCompiledBinary()) return true // Skip in dev
  const expectedHash = '%%PTY_LIB_HASH_PLACEHOLDER%%'
  if (expectedHash.includes('PLACEHOLDER')) return true // Not baked
  const actualHash = /* sha256 of file */
  return actualHash === expectedHash
}
```

---

## File Manifest

### New files

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `packages/bridge/native/pty/pty_helper.c` | C helper (forkpty + resize + I/O) | ~120 |
| `packages/bridge/src/pty/native-pty.ts` | TypeScript FFI wrapper | ~220 |
| `packages/bridge/src/pty/manager.ts` | Routes PTY to OC or native | ~120 |
| `packages/bridge/src/pty/types.ts` | Shared PTY types | ~30 |

### Modified files

| File | Change |
|------|--------|
| `packages/bridge/src/server.ts` | Replace `requireOpenCode()` in PTY handlers with `ptyManager.*` |
| `packages/bridge/scripts/build.sh` | Add PTY helper compilation + hash baking |
| `packages/bridge/src/index.ts` | Pass `ptyManager` or let server.ts create it |

### NOT modified (zero regression risk)

- `lib/` (Flutter) — no changes needed. Bridge API unchanged.
- `packages/bridge/src/connectors/opencode.ts` — OC PTY code stays as-is
- OpenCode PTY behavior — unchanged when OC is available

---

## Step-by-Step Implementation Order

### Step 1: Create the C helper
```bash
mkdir -p packages/bridge/native/pty
# Write pty_helper.c
# Test: cc -shared -o /tmp/libbroski_pty.dylib native/pty/pty_helper.c
```

### Step 2: Create the TypeScript FFI wrapper
```bash
# Write src/pty/native-pty.ts
# Test: bun run test-native-pty.ts (create, read, write, resize, kill)
```

### Step 3: Create the PTY Manager
```bash
# Write src/pty/manager.ts
# Write src/pty/types.ts
```

### Step 4: Integrate into server.ts
```bash
# Replace PTY message handlers to use ptyManager
# Keep OC WebSocket proxy code for when OC is available
# Add native PTY connection map + I/O forwarding for when OC is not
# Add cleanup in shutdown handler
```

### Step 5: Update build script
```bash
# Add PTY helper compilation to build.sh
# Add hash baking for integrity verification
# Test: sh scripts/build.sh --target darwin-arm64
# Verify: dist/libbroski_pty.dylib exists alongside binary
```

### Step 6: Test all scenarios
```bash
# Scenario A: OC running → PTY works via OC (regression test)
# Scenario B: OC not installed → PTY works via native (new capability)
# Scenario C: Create, type commands, resize, kill → all work
# Scenario D: Multiple concurrent terminals → all work
# Scenario E: Bridge restart → child processes cleaned up
```

---

## Testing Checklist

### Scenario A: OpenCode available (regression)
- [ ] `list_pty` returns sessions
- [ ] `create_pty` creates a new terminal
- [ ] `pty_connect` streams output
- [ ] `pty_input` sends keystrokes
- [ ] `pty_resize` changes terminal size
- [ ] `pty_disconnect` + `delete_pty` cleans up
- [ ] Verify: bridge uses OC PTY (check logs for WebSocket connection)

### Scenario B: OpenCode NOT available (new)
- [ ] Bridge starts without errors
- [ ] `list_pty` returns empty (no crash)
- [ ] `create_pty` creates a native terminal
- [ ] Shell gets a real PTY (`tty` returns `/dev/ttys*`, `isatty()=true`)
- [ ] Colors work (`ls --color`, colored prompt)
- [ ] `stty size` returns correct dimensions
- [ ] `pty_resize` changes size (verify with `stty size` after)
- [ ] Interactive programs work (vim, htop, top)
- [ ] Ctrl+C sends SIGINT to foreground process
- [ ] `delete_pty` kills shell and cleans up FD

### Scenario C: Edge cases
- [ ] Create 10 terminals simultaneously → all work
- [ ] Kill bridge process → child shells are cleaned up (no orphans)
- [ ] Shell exits on its own (type `exit`) → session marked as exited
- [ ] Very fast output (e.g., `yes` command) → doesn't overwhelm bridge
- [ ] Very large input (>10KB) → rejected with error

### Scenario D: Binary distribution
- [ ] `libbroski_pty.dylib` present in dist/ after build
- [ ] Hash baked into binary (check with strings)
- [ ] Binary loads the library successfully
- [ ] Binary works without the library (falls back to OC, or shows clear error)

---

## Summary

**What this gives us:**
- Terminal works for ALL users regardless of which AI agent they have installed
- Zero regression for existing OpenCode users (same code path as today)
- Ships as a ~10KB native library alongside the binary (same pattern as license lib)
- Full PTY features: colors, vim, htop, resize, Ctrl+C — everything works
- Secure: hash-verified library, input validation, resource limits, proper cleanup

**What this does NOT change:**
- Flutter app — zero changes needed
- OpenCode PTY code — stays exactly as-is
- Bridge API — same messages, same responses
- Other SDK features (MCP, worktrees, etc.) — still require their respective SDKs
