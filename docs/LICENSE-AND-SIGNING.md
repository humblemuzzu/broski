# Broski Bridge — License & Binary Signing Guide

> **Read this before every release.** This covers everything needed to ship
> tamper-proof binaries on macOS, Linux, and Windows. Total cost: $0 extra
> (uses your existing Apple Developer cert + free Ed25519 signing).

---

## Table of Contents

1. [How It Works (30-second overview)](#how-it-works)
2. [Prerequisites Checklist](#prerequisites-checklist)
3. [One-Time Setup (already done, but verify)](#one-time-setup)
4. [Release Workflow (do this every time)](#release-workflow)
5. [Platform-Specific Signing](#platform-specific-signing)
6. [CI/CD Setup](#cicd-setup)
7. [Testing & Verification](#testing--verification)
8. [Troubleshooting](#troubleshooting)
9. [Security Architecture Reference](#security-architecture-reference)
10. [Key Rotation](#key-rotation)

---

## How It Works

```
BUILD                          SHIP                           RUNTIME
─────                          ────                           ───────
bun build --compile     →   binary + .sig file     →    startup integrity check
                        →   (macOS: codesign too)  →    ├─ codesign verify (macOS)
                                                        ├─ sentinel check (all)
                                                        ├─ .sig hash verify (all)
                                                        └─ re-check every 5 min
```

**Three layers protect the binary:**

| Layer | What | Protects against | Platform |
|-------|------|-----------------|----------|
| **Sentinel** | SHA-256 of critical constants (pubkey, domain, algo) baked into code | Hex-editing the public key or domain check | All |
| **Signed hash (.sig)** | Ed25519 signature of the binary's SHA-256 | ANY binary modification, .sig deletion | All |
| **OS codesign** | Apple codesign (macOS), Authenticode (Windows, optional) | Binary modification at OS level | macOS, Windows |

**The .sig file is the most important one.** It's free, cross-platform, and
unforgeable without the private key. The binary refuses to start without it.

---

## Prerequisites Checklist

Before your first release, make sure you have:

- [ ] **Ed25519 private key** in Convex environment variables
- [ ] **Ed25519 public key** matches what's in `packages/bridge/src/license/fallback.ts`
- [ ] **Apple Developer account** (you already have this — Team ID: `FGYQ983C57`)
- [ ] **Bun installed** (`curl -fsSL https://bun.sh/install | bash`)
- [ ] **Node.js installed** (for the sentinel computation in build script)

### Where your keys live

| Key | Where | Format |
|-----|-------|--------|
| **Private key** (SECRET) | Convex dashboard → Environment Variables → `BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL` | PKCS8 DER, base64url |
| **Public key** (safe to commit) | `packages/bridge/src/license/fallback.ts` line 10 | SPKI DER, base64url |
| **Same public key (copy)** | `packages/bridge/src/license/integrity.ts` → `INTEGRITY_PUBLIC_KEY_SPKI_DER_B64URL` | Same |
| **Sentinel hash** | `packages/bridge/src/license/integrity.ts` → `EXPECTED_SENTINEL_CHUNKS` | SHA-256 hex, split into 4 chunks |

---

## One-Time Setup

### 1. Generate Ed25519 keypair (ALREADY DONE — skip unless rotating)

```bash
cd packages/bridge
node scripts/generate-license-keys.mjs
```

Output:
```
BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL=<private-key>    ← Convex secret
LICENSE_PUBLIC_KEY_SPKI_DER_B64URL=<public-key>          ← Embed in code
```

### 2. Set the private key in Convex (ALREADY DONE — verify it's there)

```bash
# Go to: https://dashboard.convex.dev → Your project → Settings → Environment Variables
# Verify this exists:
#   BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL = <your-private-key>
```

### 3. Verify public keys match across files

```bash
cd packages/bridge

# These two should output the SAME key:
grep "LICENSE_PUBLIC_KEY_SPKI_DER_B64URL" src/license/fallback.ts
grep "INTEGRITY_PUBLIC_KEY_SPKI_DER_B64URL" src/license/integrity.ts

# Current key: MCowBQYDK2VwAyEARXrmjPy-wNpwAzbarnZIQc9hvmOFrVLv5dTuGK2j-eM
```

### 4. Verify sentinel is correct

```bash
cd packages/bridge

# This should say "✓ MATCH":
SENTINEL=$(node -e "
const crypto = require('crypto');
const values = [
  'MCowBQYDK2VwAyEARXrmjPy-wNpwAzbarnZIQc9hvmOFrVLv5dTuGK2j-eM',
  'BRSK-LICENSE',
  '.convex.site',
  'EdDSA',
  'v1',
];
process.stdout.write(crypto.createHash('sha256').update(values.join('\x00')).digest('hex'));
")
EXPECTED=$(sed -n '/EXPECTED_SENTINEL_CHUNKS/,/^\]/p' src/license/integrity.ts \
  | grep -oE "'[0-9a-f]+'" | tr -d "'" | tr -d '\n')
echo "Computed: $SENTINEL"
echo "In code:  $EXPECTED"
[ "$SENTINEL" = "$EXPECTED" ] && echo "✓ MATCH" || echo "✗ MISMATCH — UPDATE integrity.ts!"
```

---

## Release Workflow

### Quick version (copy-paste this):

```bash
# 1. cd to bridge
cd packages/bridge

# 2. Set signing key (or export in your shell profile)
export BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL="<your-private-key-from-convex>"

# 3. Build all platforms (or use --target for one)
sh scripts/build.sh

# 4. macOS: codesign + notarize (see section below)

# 5. Upload dist/ contents to your download server
#    Each binary needs its .sig file next to it:
#      broski-darwin-arm64      + broski-darwin-arm64.sig
#      broski-darwin-x64        + broski-darwin-x64.sig
#      broski-linux-x64         + broski-linux-x64.sig
#      broski-linux-arm64       + broski-linux-arm64.sig
#      broski-windows-x64.exe   + broski-windows-x64.exe.sig
```

### Detailed version:

#### Step 1: Build

```bash
cd packages/bridge

# Build all platforms:
sh scripts/build.sh

# Or build one platform:
sh scripts/build.sh --target darwin-arm64
sh scripts/build.sh --target darwin-x64
sh scripts/build.sh --target linux-x64
sh scripts/build.sh --target linux-arm64
sh scripts/build.sh --target windows-x64
```

The build script will:
- ✅ Compute and verify the sentinel hash
- ✅ Compile the binary with `bun build --compile`
- ✅ Generate `.sig` files (if `BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL` is set)
- ⚠️ Warn you if signing key is missing

#### Step 2: Sign (automatic if key is set)

The build script handles `.sig` generation automatically. Just make sure the env var is set:

```bash
export BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL="<key>"
```

If you forgot to set it, you can sign after the fact:

```bash
# Sign a single binary manually:
node -e "
const crypto = require('crypto');
const fs = require('fs');
const privDer = Buffer.from(process.env.BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL, 'base64url');
const privKey = crypto.createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
const binary = fs.readFileSync('dist/broski-linux-x64');
const hash = crypto.createHash('sha256').update(binary).digest('hex');
const sig = crypto.sign(null, Buffer.from(hash, 'utf-8'), privKey);
fs.writeFileSync('dist/broski-linux-x64.sig', sig.toString('base64url'));
console.log('✓ Signed');
"
```

#### Step 3: macOS codesign (see next section)

#### Step 4: Upload

Upload BOTH files for each platform to your download server:
```
https://broskiapp.com/download/broski-darwin-arm64
https://broskiapp.com/download/broski-darwin-arm64.sig
https://broskiapp.com/download/broski-linux-x64
https://broskiapp.com/download/broski-linux-x64.sig
... etc
```

The install scripts (`install.sh` / `install.ps1`) download both automatically.

---

## Platform-Specific Signing

### macOS — Apple Codesign + Notarization

You MUST do this or macOS Gatekeeper will block the binary for users.

```bash
# Your existing Apple Developer identity:
IDENTITY="Developer ID Application: Your Name (FGYQ983C57)"

# 1. Sign the binary
codesign --force --sign "$IDENTITY" \
  --options runtime \
  --timestamp \
  dist/broski-darwin-arm64

# 2. Verify it worked
codesign --verify --deep --strict --verbose=2 dist/broski-darwin-arm64

# 3. Notarize (so Gatekeeper accepts it on other Macs)
#    First, create an app-specific password at https://appleid.apple.com
#    Store it in Keychain:
xcrun notarytool store-credentials "broski-notarize" \
  --apple-id "your@email.com" \
  --team-id "FGYQ983C57" \
  --password "your-app-specific-password"

#    Then submit:
xcrun notarytool submit dist/broski-darwin-arm64 \
  --keychain-profile "broski-notarize" \
  --wait

# 4. Check notarization status
xcrun notarytool info <submission-id> --keychain-profile "broski-notarize"

# 5. Do the same for intel mac if you ship it:
codesign --force --sign "$IDENTITY" --options runtime --timestamp dist/broski-darwin-x64
xcrun notarytool submit dist/broski-darwin-x64 --keychain-profile "broski-notarize" --wait
```

**⚠️ IMPORTANT:** Codesign BEFORE generating the `.sig` file, because codesigning
modifies the binary. If you already built with the signing key set, re-sign the
`.sig` after codesigning:

```bash
# After codesign, regenerate the .sig:
export BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL="<key>"
node -e "
const crypto = require('crypto');
const fs = require('fs');
const privDer = Buffer.from(process.env.BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL, 'base64url');
const privKey = crypto.createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
const binary = fs.readFileSync('dist/broski-darwin-arm64');
const hash = crypto.createHash('sha256').update(binary).digest('hex');
const sig = crypto.sign(null, Buffer.from(hash, 'utf-8'), privKey);
fs.writeFileSync('dist/broski-darwin-arm64.sig', sig.toString('base64url'));
console.log('✓ Re-signed after codesign');
"
```

### Linux — No extra steps needed

The `.sig` file is your protection. No OS-level signing needed.

```bash
# Just build with the key set:
export BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL="<key>"
sh scripts/build.sh --target linux-x64
# dist/broski-linux-x64 + dist/broski-linux-x64.sig ← both ship together
```

### Windows — No extra steps needed (for now)

The `.sig` file handles tamper protection. Authenticode is optional ($200/yr)
and only affects whether users see "Unknown publisher" on first run.
Your developer audience won't care.

If you want to add Authenticode later:
- **Cheap option:** Azure Trusted Signing (~$10/month)
- **Standard:** DigiCert EV code signing (~$200-400/yr)
- **Free option:** Self-signed cert (won't fix SmartScreen, but our code
  already handles `HashMismatch` detection)

---

## CI/CD Setup

### GitHub Actions example:

```yaml
name: Build & Sign Bridge

on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest
            target: darwin-arm64
          - os: macos-latest
            target: darwin-x64
          - os: ubuntu-latest
            target: linux-x64
          - os: ubuntu-latest
            target: linux-arm64
          - os: windows-latest
            target: windows-x64

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: cd packages/bridge && bun install

      - name: Build & sign
        env:
          BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL: ${{ secrets.BROSKI_LICENSE_PRIVATE_KEY }}
        run: |
          cd packages/bridge
          sh scripts/build.sh --target ${{ matrix.target }}

      - name: macOS codesign
        if: startsWith(matrix.target, 'darwin')
        env:
          APPLE_CERT_BASE64: ${{ secrets.APPLE_CERT_BASE64 }}
          APPLE_CERT_PASSWORD: ${{ secrets.APPLE_CERT_PASSWORD }}
          APPLE_TEAM_ID: FGYQ983C57
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
        run: |
          # Import certificate
          echo "$APPLE_CERT_BASE64" | base64 --decode > cert.p12
          security create-keychain -p "" build.keychain
          security import cert.p12 -k build.keychain -P "$APPLE_CERT_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
          security default-keychain -s build.keychain

          BINARY="packages/bridge/dist/broski-${{ matrix.target }}"

          # Codesign
          codesign --force --sign "Developer ID Application: Your Name ($APPLE_TEAM_ID)" \
            --options runtime --timestamp "$BINARY"

          # Re-generate .sig after codesign (codesign modifies binary)
          node -e "
          const crypto = require('crypto');
          const fs = require('fs');
          const k = Buffer.from(process.env.BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL, 'base64url');
          const pk = crypto.createPrivateKey({ key: k, format: 'der', type: 'pkcs8' });
          const b = fs.readFileSync('$BINARY');
          const h = crypto.createHash('sha256').update(b).digest('hex');
          const s = crypto.sign(null, Buffer.from(h, 'utf-8'), pk);
          fs.writeFileSync('${BINARY}.sig', s.toString('base64url'));
          "

          # Notarize
          xcrun notarytool submit "$BINARY" \
            --apple-id "$APPLE_ID" \
            --team-id "$APPLE_TEAM_ID" \
            --password "$APPLE_APP_SPECIFIC_PASSWORD" \
            --wait

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: broski-${{ matrix.target }}
          path: |
            packages/bridge/dist/broski-${{ matrix.target }}*
```

### GitHub Secrets you need:

| Secret | Value | Where to get it |
|--------|-------|-----------------|
| `BROSKI_LICENSE_PRIVATE_KEY` | Your Ed25519 private key (base64url) | Convex dashboard → Environment Variables |
| `APPLE_CERT_BASE64` | Your Developer ID cert as base64 | Keychain Access → Export → base64 encode |
| `APPLE_CERT_PASSWORD` | Password for the exported .p12 | You set this when exporting |
| `APPLE_ID` | Your Apple ID email | Your Apple account |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password | https://appleid.apple.com → Sign-In & Security |

---

## Testing & Verification

### Test locally (dev mode — no signing needed):

```bash
cd packages/bridge

# In dev mode, just run from source — all integrity checks are skipped:
bun src/index.ts serve
```

### Test with signing:

```bash
cd packages/bridge

# Build WITH signing:
export BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL="<your-key>"
sh scripts/build.sh --target darwin-arm64

# Run — should pass all integrity checks:
./dist/broski-darwin-arm64 serve

# Tamper test — modify binary and see it fail:
echo "tampered" >> ./dist/broski-darwin-arm64
./dist/broski-darwin-arm64 serve
# Should print: ❌ Integrity check failed
```

### Verify .sig file manually:

```bash
# Compute binary hash:
shasum -a 256 dist/broski-darwin-arm64

# Verify the .sig file contains a valid signature of that hash:
node -e "
const crypto = require('crypto');
const fs = require('fs');
const pubB64 = 'MCowBQYDK2VwAyEARXrmjPy-wNpwAzbarnZIQc9hvmOFrVLv5dTuGK2j-eM';
const pubDer = Buffer.from(pubB64, 'base64url');
const pubKey = crypto.createPublicKey({ key: pubDer, format: 'der', type: 'spki' });
const binary = fs.readFileSync('dist/broski-darwin-arm64');
const hash = crypto.createHash('sha256').update(binary).digest('hex');
const sig = Buffer.from(fs.readFileSync('dist/broski-darwin-arm64.sig', 'utf-8').trim(), 'base64url');
const valid = crypto.verify(null, Buffer.from(hash, 'utf-8'), pubKey, sig);
console.log(valid ? '✓ Signature valid' : '✗ Signature INVALID');
"
```

---

## Troubleshooting

### "Binary signature file missing"
The `.sig` sidecar file is not next to the binary. Either:
- Build with `BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL` set
- For local dev testing: run from source (`bun src/index.ts serve`) — integrity checks skip in dev mode

### "Binary integrity check failed: security constants modified"
Sentinel mismatch. Someone (or you) changed a critical constant without
updating the sentinel hash. Run:
```bash
cd packages/bridge
node -e "
const crypto = require('crypto');
const values = [
  'MCowBQYDK2VwAyEARXrmjPy-wNpwAzbarnZIQc9hvmOFrVLv5dTuGK2j-eM',
  'BRSK-LICENSE', '.convex.site', 'EdDSA', 'v1',
];
console.log(crypto.createHash('sha256').update(values.join('\x00')).digest('hex'));
"
```
Then split the hash into 4 x 16-char chunks and update `EXPECTED_SENTINEL_CHUNKS`
in `src/license/integrity.ts`.

### "macOS code signature verification failed"
Binary was modified after codesigning (or not signed at all).
Re-codesign: `codesign --force --sign "Developer ID Application: ..." dist/broski-darwin-arm64`

### "Binary signature verification failed — binary may be tampered"
The `.sig` file exists but doesn't match the binary. Re-generate:
```bash
export BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL="<key>"
node -e "
const crypto = require('crypto');
const fs = require('fs');
const k = Buffer.from(process.env.BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL, 'base64url');
const pk = crypto.createPrivateKey({ key: k, format: 'der', type: 'pkcs8' });
const b = fs.readFileSync('dist/broski-darwin-arm64');
const h = crypto.createHash('sha256').update(b).digest('hex');
const s = crypto.sign(null, Buffer.from(h, 'utf-8'), pk);
fs.writeFileSync('dist/broski-darwin-arm64.sig', s.toString('base64url'));
"
```

### Build script says "Sentinel mismatch"
You changed one of these values but forgot to update the sentinel:
- Public key in `fallback.ts`
- JWS type (`BRSK-LICENSE`)
- Convex domain (`.convex.site`)
- Algorithm (`EdDSA`)
- Key ID (`v1`)

Update `EXPECTED_SENTINEL_CHUNKS` in `integrity.ts` (see sentinel troubleshooting above).

---

## Security Architecture Reference

### What each file does:

```
packages/bridge/src/license/
├── index.ts          # Re-exports everything, loads local license from disk
├── fallback.ts       # Pure-TS Ed25519 verify, AES-256-GCM encrypt/decrypt
│                     # Contains: PUBLIC KEY, JWS verification, machine ID
├── native.ts         # Optional Rust FFI for license ops (harder to reverse)
├── store.ts          # Read/write ~/.broski/license.enc (encrypted license)
└── integrity.ts      # Binary integrity verification
                      # Contains: sentinel, signed hash, codesign, native
                      # sidecar hash check, redundant compiled-binary
                      # detection, periodic re-check
```

### What happens at runtime:

```
Binary starts
  │
  ├─ looksLikeCompiledBinary()? (redundant 3-check detection)
  │   ├─ isCompiledBinary()? (process.execPath === process.argv[1])
  │   ├─ .sig file exists next to binary?
  │   └─ Native lib hash placeholder replaced by build script?
  │
  ├─ ALL THREE = NO ──→ Dev mode, all checks skipped
  │
  ANY = YES
  │
  ├─ verifyBinaryIntegrity()
  │   ├─ macOS? → codesign --verify
  │   ├─ Windows? → Get-AuthenticodeSignature
  │   ├─ Sentinel check (hash of critical constants)
  │   ├─ .sig file check (Ed25519 signature of binary SHA-256)
  │   └─ Native sidecar check (SHA-256 of .dylib/.so/.dll vs baked hash)
  │
  ├─ ANY FAIL? → print error, process.exit(1)
  │
  ├─ startPeriodicIntegrityCheck() → re-run every ~5 min (jittered)
  │
  ├─ createBridgeServer()
  │   ├─ requireEntitlement = true (hardcoded, compiled)
  │   ├─ compiled && !requireEntitlement → throw (defense-in-depth)
  │   ├─ TLS forced (compiled)
  │   ├─ Convex domain pinned to .convex.site
  │   └─ Every WS message → check entitled + license not expired
  │
  └─ Running ✓
```

### What an attacker would need to do:

1. Patch Ed25519 public key → ❌ sentinel detects
2. Patch sentinel → ❌ .sig detects (binary hash changed)
3. Delete .sig → ❌ binary refuses to start
4. Forge new .sig → ❌ needs private key (in Convex, never shipped)
5. Patch the .sig check code → ❌ sentinel detects (binary hash changed + codesign on macOS)
6. Swap native .dylib/.so/.dll → ❌ native sidecar hash check detects (hash baked into binary at build time)
7. Patch isCompiledBinary() → ❌ redundant detection via .sig existence + native hash placeholder check
8. All of the above simultaneously → still need own Convex backend

---

## Key Rotation

If your private key is compromised, rotate immediately:

```bash
# 1. Generate new keypair
cd packages/bridge
node scripts/generate-license-keys.mjs

# 2. Update public key in TWO files:
#    - src/license/fallback.ts → LICENSE_PUBLIC_KEY_SPKI_DER_B64URL
#    - src/license/integrity.ts → INTEGRITY_PUBLIC_KEY_SPKI_DER_B64URL

# 3. Recompute sentinel (the hash changes because the public key changed):
node -e "
const crypto = require('crypto');
const values = ['<NEW-PUBLIC-KEY>', 'BRSK-LICENSE', '.convex.site', 'EdDSA', 'v1'];
console.log(crypto.createHash('sha256').update(values.join('\x00')).digest('hex'));
"
# Split into 4 chunks, update EXPECTED_SENTINEL_CHUNKS in integrity.ts

# 4. Update private key in Convex:
#    Dashboard → Environment Variables → BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL

# 5. Build + sign + ship new binaries

# 6. Old binaries will still work until their license.enc expires
#    (max 72 hours offline grace). After that, they must re-authenticate
#    and will get a new license signed with the new key.
```

---

## Development Mode (What You Do Day-to-Day)

**During development, ALL integrity checks are automatically skipped.** You don't
need to do anything special. Here's why:

```
isCompiledBinary() → false (you're running `bun src/index.ts`, not a compiled binary)
  → verifyBinaryIntegrity() → { ok: true, all checks: skipped }
  → startPeriodicIntegrityCheck() → no-op
  → requireEntitlement → reads from config/env (defaults to true, but can be overridden)
  → TLS → can be disabled with BROSKI_TLS=0
```

### Daily dev workflow — nothing changes:

```bash
cd packages/bridge

# Start the bridge (same as always):
bun run dev
# or
bun src/index.ts serve

# Run tests:
bun test src/license/
```

### When you need to test WITHOUT entitlement checks (local dev):

```bash
# Option 1: Set env var
BROSKI_REQUIRE_ENTITLEMENT=0 bun src/index.ts serve

# Option 2: Edit ~/.broski/config.json
#   "cloud": { "requireEntitlement": false }
```

These overrides ONLY work in dev mode. In compiled binaries, `requireEntitlement`
is hardcoded to `true` and env vars are ignored.

### When you want to test the compiled binary locally:

```bash
# You MUST sign now — there is no skip mechanism (by design).
# Set the signing key and build:
export BROSKI_LICENSE_PRIVATE_KEY_PKCS8_B64URL="<your-key>"
sh scripts/build.sh --target darwin-arm64   # builds + signs
./dist/broski-darwin-arm64 serve            # full integrity checks

# If you just need to test code, use dev mode instead:
bun src/index.ts serve                      # no signing needed
```

### Running tests:

```bash
cd packages/bridge

# Run all license/integrity tests:
bun test src/license/

# Expected output:
#   17 pass, 0 fail
#   - integrity dev mode checks (skipped correctly)
#   - sentinel hash matches
#   - license crypto roundtrip works
#   - encrypt/decrypt not broken
#   - exports not broken
```

---

## Pre-Launch Checklist

Before flipping the switch:

- [ ] Private key is in Convex env vars
- [ ] Public key matches in `fallback.ts` and `integrity.ts`
- [ ] Sentinel hash matches (build script verifies this)
- [ ] Build with signing key → `.sig` files generated
- [ ] macOS binary codesigned + notarized
- [ ] `.sig` re-generated AFTER codesigning (order matters!)
- [ ] Upload binary + .sig to download server
- [ ] Test fresh install: `curl -fsSL https://broskiapp.com/install.sh | sh`
- [ ] Test `broski serve` starts without integrity errors
- [ ] Test tampering: modify binary → verify it refuses to start
- [ ] Verify no `BROSKI_SKIP_SIG_CHECK` references remain in codebase (removed in hardening pass)
- [ ] RevenueCat webhook is connected to Convex
- [ ] Test purchase flow: subscribe → bridge accepts connection
- [ ] Test revocation: cancel subscription → bridge disconnects within 30 min
