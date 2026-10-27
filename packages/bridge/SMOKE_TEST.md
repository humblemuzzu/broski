# Broski Bridge — Smoke Test Checklist

Run these tests on each platform after building a new release.

## macOS (Apple Silicon — darwin-arm64)

Binary: `broski-darwin-arm64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: darwin-arm64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates (prints result or "Could not reach update server")
- [ ] `broski doctor` — runs diagnostics, checks Bun, OpenCode, port availability
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

## Linux (x64 — linux-x64)

Binary: `broski-linux-x64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: linux-x64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates
- [ ] `broski doctor` — runs diagnostics
- [ ] `broski install` — installs the `broski-link` systemd user service (`~/.config/systemd/user/broski-link.service`)
- [ ] `broski status` — shows service status, version, update check
- [ ] `broski stop` — stops the systemd service
- [ ] `broski restart` — restarts the systemd service
- [ ] `broski uninstall` — removes the systemd unit file, daemon-reload
- [ ] `broski` (serve) — starts the bridge server
- [ ] `broski-link pair` — shows a QR code
- [ ] Loopback TLS certificate generation works (openssl)
- [ ] Phone can pair via QR scan

## Linux (ARM — linux-arm64)

Binary: `broski-linux-arm64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: linux-arm64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates
- [ ] `broski doctor` — runs diagnostics
- [ ] `broski install` — installs the `broski-link` systemd user service
- [ ] `broski status` — shows service status, version, update check
- [ ] `broski` (serve) — starts the bridge server
- [ ] `broski-link pair` — shows a QR code
- [ ] Loopback TLS certificate generation works
- [ ] Phone can pair via QR scan

## Windows (x64 — win32-x64)

Binary: `broski-windows-x64.exe`

Broski Link is not supported on Windows, so only the local commands are checked.

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: win32-x64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates
- [ ] `broski doctor` — runs diagnostics
- [ ] `broski install` — prints "Broski Link is not supported on Windows yet." and installs nothing

## Cross-Platform Notes

- Daemon types: macOS=LaunchAgent, Linux=systemd user service (both run `broski-link`); Windows has none
- Port detection: macOS/Linux=lsof+ss, Windows=netstat
- TLS (loopback listener for agent hooks): macOS/Linux=openssl CLI, Windows=openssl or PowerShell New-SelfSignedCertificate
- Process kill: macOS/Linux=kill -9, Windows=taskkill /F
- Binary detection: `isCompiledBinary()` checks `process.execPath === process.argv[1]`
