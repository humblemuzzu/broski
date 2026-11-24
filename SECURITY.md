# Security Policy

## Security model

Broski is a personal remote-control tool for your own Mac and your own phone. A paired phone intentionally has the same capabilities as your local terminal: running coding agents, executing shell commands, and reading or writing files inside allowed directories. Pair only devices you own.

### Worth reporting

- Flaws in the QR pairing lifecycle (secret reuse, expiry bypass, device revocation bypass, or token leaks)
- Noise handshake or encryption bugs, relay blindness breaks, or key storage issues
- Loopback listener hardening bypasses (TLS, bearer token, host/bind restrictions, `/mcp` auth)
- Path traversal or symlink escape past configured workspace boundaries
- Memory exhaustion, unbounded frame parsing, or denial-of-service bugs

### Out of scope (intentional design)

- Shell/PTY access, file read/write, and agent command execution by an already-paired device
- The pairing QR carrying the one-time pairing secret (shown only on your Mac and consumed on first pairing)
- The bridge reading your installed agent credentials or proxying local dev servers on loopback

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

1. Use [GitHub Private Vulnerability Reporting](https://github.com/humblemuzzu/broski/security/advisories/new) on this repository (preferred), or
2. Email **broskiappp@gmail.com** with a description, reproduction steps, and affected component.

Include the commit SHA or release version if you have it. We will acknowledge reports as soon as possible and coordinate a fix before public disclosure.
