# Broski Bridge — Smoke Test Checklist

Run these tests on each Mac architecture after building a new release.

## macOS (Apple Silicon — darwin-arm64)

Binary: `broski-darwin-arm64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: darwin-arm64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates (prints result or "Could not reach update server")
- [ ] `broski doctor` — runs diagnostics, checks Bun, agents, port availability
- [ ] `broski install` — installs the `broski-link` LaunchAgent (`~/Library/LaunchAgents/com.broski.link.plist`)
- [ ] `broski status` — shows service installed/running, port 18274 status, version, update check
- [ ] `broski stop` — stops the background service
- [ ] `broski restart` — restarts the background service, port becomes available
- [ ] `broski uninstall` — removes the LaunchAgent plist
- [ ] `broski` (serve) — starts the bridge server on `127.0.0.1`
- [ ] `broski-link pair` — shows a QR code for phone pairing
- [ ] `broski-link status` — shows the bridge `up`, the relay state and paired devices
- [ ] Loopback TLS certificate generation works (self-signed via openssl)
- [ ] Phone pairs via QR scan and connects over the local network
- [ ] Phone connects through the relay when it is off the local network

## macOS (Intel — darwin-x64)

Binary: `broski-darwin-x64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: darwin-x64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates
- [ ] `broski doctor` — runs diagnostics
- [ ] `broski install` — installs the `broski-link` LaunchAgent
- [ ] `broski status` — shows service status, version, update check
- [ ] `broski stop` — stops the background service
- [ ] `broski restart` — restarts the background service
- [ ] `broski uninstall` — removes the LaunchAgent
- [ ] `broski` (serve) — starts the bridge server
- [ ] `broski-link pair` — shows a QR code
- [ ] Loopback TLS certificate generation works
- [ ] Phone can pair via QR scan

## Notes

- Daemon type: macOS LaunchAgent, which runs `broski-link`
- Port detection: `lsof`
- TLS (loopback listener for agent hooks): the `openssl` CLI
- Process kill: `kill -9`
- Binary detection: `isCompiledBinary()` checks `process.execPath === process.argv[1]`
