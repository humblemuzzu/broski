# Broski Bridge — Smoke Test Checklist

Run these tests on each platform after building a new release.

## macOS (Apple Silicon — darwin-arm64)

Binary: `broski-darwin-arm64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: darwin-arm64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates (prints result or "Could not reach update server")
- [ ] `broski doctor` — runs diagnostics, checks Bun, OpenCode, Tailscale, port availability
- [ ] `broski install` — installs LaunchAgent (`~/Library/LaunchAgents/com.broski.bridge.plist`)
- [ ] `broski status` — shows service installed/running, port 18274 status, version, update check
- [ ] `broski stop` — stops the background service
- [ ] `broski restart` — restarts the background service, port becomes available
- [ ] `broski uninstall` — removes the LaunchAgent plist
- [ ] `broski` (serve) — starts the bridge server, shows QR code
- [ ] `broski qr` — shows QR code for phone pairing
- [ ] `broski qr --hotspot` — shows QR code with hotspot IP
- [ ] Network detection: local IP discovered (en0)
- [ ] Network detection: Tailscale IP detected (if installed)
- [ ] TLS certificate generation works (self-signed via openssl)
- [ ] Phone connects via QR scan over local Wi-Fi
- [ ] Phone connects via QR scan over Tailscale

## macOS (Intel — darwin-x64)

Binary: `broski-darwin-x64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: darwin-x64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates
- [ ] `broski doctor` — runs diagnostics
- [ ] `broski install` — installs LaunchAgent
- [ ] `broski status` — shows service status, version, update check
- [ ] `broski stop` — stops the background service
- [ ] `broski restart` — restarts the background service
- [ ] `broski uninstall` — removes the LaunchAgent
- [ ] `broski` (serve) — starts the bridge server
- [ ] `broski qr` — shows QR code
- [ ] Network detection works (local IP, Tailscale)
- [ ] TLS certificate generation works
- [ ] Phone can connect via QR scan

## Linux (x64 — linux-x64)

Binary: `broski-linux-x64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: linux-x64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates
- [ ] `broski doctor` — runs diagnostics
- [ ] `broski install` — installs systemd user service (`~/.config/systemd/user/broski-bridge.service`)
- [ ] `broski status` — shows service status, version, update check
- [ ] `broski stop` — stops the systemd service
- [ ] `broski restart` — restarts the systemd service
- [ ] `broski uninstall` — removes the systemd unit file, daemon-reload
- [ ] `broski` (serve) — starts the bridge server
- [ ] `broski qr` — shows QR code
- [ ] Network detection works (eth0/wlan0 interfaces, Tailscale)
- [ ] TLS certificate generation works (openssl)
- [ ] Phone can connect via QR scan

## Linux (ARM — linux-arm64)

Binary: `broski-linux-arm64`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: linux-arm64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates
- [ ] `broski doctor` — runs diagnostics
- [ ] `broski install` — installs systemd user service
- [ ] `broski status` — shows service status, version, update check
- [ ] `broski` (serve) — starts the bridge server
- [ ] `broski qr` — shows QR code
- [ ] Network detection works
- [ ] TLS certificate generation works
- [ ] Phone can connect via QR scan

## Windows (x64 — win32-x64)

Binary: `broski-windows-x64.exe`

- [ ] `broski version` — prints version, `(compiled binary)`, `Platform: win32-x64`
- [ ] `broski --version` — same output as `broski version`
- [ ] `broski --help` — shows help text with all commands listed
- [ ] `broski update` — checks for updates
- [ ] `broski doctor` — runs diagnostics
- [ ] `broski install` — creates scheduled task (`BroskiBridge` via schtasks)
- [ ] `broski status` — shows task status, version, update check
- [ ] `broski stop` — ends the scheduled task
- [ ] `broski restart` — restarts the scheduled task
- [ ] `broski uninstall` — deletes the scheduled task
- [ ] `broski` (serve) — starts the bridge server
- [ ] `broski qr` — shows QR code
- [ ] Network detection works (netstat-based port check, Tailscale)
- [ ] TLS certificate generation works (PowerShell fallback if no openssl)
- [ ] Phone can connect via QR scan

## Cross-Platform Notes

- Daemon types: macOS=LaunchAgent, Linux=systemd user service, Windows=Task Scheduler
- Port detection: macOS/Linux=lsof+ss, Windows=netstat
- TLS: macOS/Linux=openssl CLI, Windows=openssl or PowerShell New-SelfSignedCertificate
- Process kill: macOS/Linux=kill -9, Windows=taskkill /F
- Binary detection: `isCompiledBinary()` checks `process.execPath === process.argv[1]`
