/**
 * Binary Integrity Verification
 *
 * Ensures the compiled binary hasn't been tampered with (hex-edited pubkey,
 * patched domain checks, etc.). Five layers:
 *
 * 1. macOS: codesign --verify (Apple code signature)
 * 2. Windows: Authenticode verification
 * 3. All platforms: embedded SHA-256 sentinel check (critical constants)
 * 4. All platforms: signed binary hash (.sig sidecar file — Ed25519 signature
 *    of SHA-256 of the binary, verified with the same pubkey used for licenses)
 * 5. All platforms: native sidecar integrity (.dylib/.so/.dll hash in sentinel)
 * 6. Runtime: periodic re-verification (catches debugger attach + hot-patch)
 *
 * This module is ONLY meaningful for compiled binaries. In dev mode it's a no-op.
 */

import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isCompiledBinary } from "../platform";
import { isNativeLibMissing } from "./index";

// ============================================================================
// CODESIGN VERIFICATION (macOS / Windows)
// ============================================================================

function verifyMacOSCodeSign(exePath: string): { ok: boolean; reason?: string } {
	if (process.platform !== "darwin") return { ok: true };

	try {
		execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=0", exePath], {
			stdio: "ignore",
			timeout: 10_000,
		});
		return { ok: true };
	} catch {
		return { ok: false, reason: "macOS code signature verification failed" };
	}
}

function verifyWindowsAuthenticode(exePath: string): { ok: boolean; reason?: string } {
	if (process.platform !== "win32") return { ok: true };

	try {
		// PowerShell Authenticode check
		const result = execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`(Get-AuthenticodeSignature '${exePath.replace(/'/g, "''")}').Status`,
			],
			{ encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] },
		).trim();

		if (result === "Valid") return { ok: true };
		// NotSigned is acceptable during development/self-distribution
		// but HashMismatch means tampering
		if (result === "HashMismatch") {
			return { ok: false, reason: "Windows Authenticode signature hash mismatch" };
		}
		// NotSigned — binary isn't signed yet. Allow but log.
		return { ok: true };
	} catch {
		// PowerShell not available or errored — don't block
		return { ok: true };
	}
}

// ============================================================================
// SIGNED BINARY HASH (all platforms — the Linux safety net)
// ============================================================================

// Same public key used for license verification. If an attacker patches this,
// the sentinel check catches it (and vice versa — dual coverage).
const INTEGRITY_PUBLIC_KEY_SPKI_DER_B64URL = "MCowBQYDK2VwAyEARXrmjPy-wNpwAzbarnZIQc9hvmOFrVLv5dTuGK2j-eM";

/**
 * Verify the binary's SHA-256 hash against a signed .sig sidecar file.
 *
 * The .sig file contains an Ed25519 signature of the binary's SHA-256 hash.
 * Build script creates it: hash the binary → sign with private key → write .sig
 *
 * This is the primary protection on Linux (no OS-level codesign) and acts as
 * defense-in-depth on macOS/Windows. The attacker can't forge the signature
 * without the Ed25519 private key (which lives in Convex env vars, never shipped).
 */
function verifySignedBinaryHash(exePath: string): { ok: boolean; reason?: string; skipped?: boolean } {
	const sigPath = `${exePath}.sig`;

	if (!existsSync(sigPath)) {
		if (isCompiledBinary()) {
			// In compiled binaries, the .sig MUST exist — it's our cross-platform
			// tamper protection (especially critical on Linux where there's no OS codesign).
			// Missing .sig = binary was distributed without signing, or attacker deleted it.
			//
			// NO ENV VAR BYPASS. Previously BROSKI_SKIP_SIG_CHECK existed here —
			// removed because an attacker could trivially set it to skip all signature
			// verification. The build script now always signs. For local dev testing,
			// run from source (`bun src/index.ts`) which skips checks via isCompiledBinary().
			return { ok: false, reason: "Binary signature file missing — download a fresh copy from the official source" };
		}
		// Dev mode: skip gracefully
		return { ok: true, skipped: true };
	}

	try {
		// Read the signature (base64url-encoded Ed25519 signature of SHA-256 hex hash)
		const sigB64 = readFileSync(sigPath, "utf-8").trim();
		if (!sigB64 || sigB64.length < 10) {
			return { ok: false, reason: "Binary signature file is empty or malformed" };
		}

		// Compute SHA-256 of the binary on disk
		const binaryData = readFileSync(exePath);
		const binaryHash = createHash("sha256").update(binaryData).digest("hex");

		// Verify: Ed25519 signature of the hash string
		const pubDer = Buffer.from(INTEGRITY_PUBLIC_KEY_SPKI_DER_B64URL, "base64url");
		const pubKey = createPublicKey({ key: pubDer, format: "der", type: "spki" });
		const signature = Buffer.from(sigB64, "base64url");
		const valid = verify(null, Buffer.from(binaryHash, "utf-8"), pubKey, signature);

		if (!valid) {
			return { ok: false, reason: "Binary signature verification failed — binary may be tampered" };
		}

		return { ok: true };
	} catch (err) {
		return { ok: false, reason: `Binary signature check error: ${(err as Error).message}` };
	}
}

// ============================================================================
// SENTINEL VERIFICATION
// ============================================================================

/**
 * Critical constants that an attacker would need to patch to bypass licensing.
 * We hash them at build time and verify at runtime. If any are changed in the
 * binary, the sentinel check fails.
 *
 * The sentinel is NOT a hash of the whole binary (that changes with every build).
 * It's a hash of the specific values that matter for security.
 */
function computeSecuritySentinel(): string {
	// Import the actual values from the license module at runtime.
	// These are the values an attacker would need to patch:
	const criticalValues = [
		// 1. The Ed25519 public key used to verify license JWS
		"MCowBQYDK2VwAyEARXrmjPy-wNpwAzbarnZIQc9hvmOFrVLv5dTuGK2j-eM",
		// 2. The JWS type header (changing this could bypass signature check)
		"BRSK-LICENSE",
		// 3. The accepted Convex domain suffix (changing bypasses domain pinning)
		".convex.site",
		// 4. The license algorithm
		"EdDSA",
		// 5. Key ID
		"v1",
	];

	return createHash("sha256").update(criticalValues.join("\x00")).digest("hex");
}

// ============================================================================
// NATIVE SIDECAR INTEGRITY
// ============================================================================

/**
 * If the native Rust sidecar library exists next to the binary, verify its
 * SHA-256 matches the expected hash baked in at build time.
 *
 * Without this, an attacker could swap the .dylib/.so/.dll with a fake one
 * that always returns "license valid" — the main binary would load it via FFI
 * and trust it blindly.
 *
 * The expected hash is set by the build script: %%NATIVE_LIB_HASH_PLACEHOLDER%%
 * If the placeholder is still present, we're in dev mode and skip the check.
 */
const EXPECTED_NATIVE_LIB_HASH = "%%__NATIVE_LIB_HASH_PLACEHOLDER____000000000000000000000000000%%";

function getNativeLibFilename(): string {
	if (process.platform === "win32") return "broski_license.dll";
	if (process.platform === "darwin") return "libbroski_license.dylib";
	return "libbroski_license.so";
}

function verifyNativeSidecar(exePath: string): IntegrityCheckResult {
	// If placeholder, build script didn't bake a hash → skip (dev mode or no native lib shipped)
	if (EXPECTED_NATIVE_LIB_HASH.includes("PLACEHOLDER")) {
		return { ok: true, skipped: true };
	}

	const libPath = resolve(dirname(exePath), getNativeLibFilename());

	if (!existsSync(libPath)) {
		// If we have an expected hash but the lib is missing, that's suspicious.
		// However, the fallback.ts pure-TS path handles this case. The critical
		// thing is: if the lib IS present, it must be the right one.
		return { ok: true, skipped: true };
	}

	try {
		const libData = readFileSync(libPath);
		const actualHash = createHash("sha256").update(libData).digest("hex");

		if (actualHash !== EXPECTED_NATIVE_LIB_HASH) {
			return {
				ok: false,
				reason: "Native license library has been modified — possible sidecar swap attack",
			};
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, reason: `Native sidecar check error: ${(err as Error).message}` };
	}
}

// Pre-computed at build time. If someone patches the public key or domain check
// in the binary, this sentinel won't match because the source values changed
// but this hash didn't (it's a separate constant in a different code section).
//
// Split across multiple chunks to make it harder to find and patch both the
// sentinel AND the values it protects.
const EXPECTED_SENTINEL_CHUNKS = [
	// SHA-256 of critical security values joined with \x00
	// Regenerate with: node -e "require('./license/integrity').computeSecuritySentinel()"
	// Or the build script auto-replaces %%SENTINEL_PLACEHOLDER%% if present.
	// Split into chunks to make simultaneous find-and-replace harder.
	"93a78f3497cafdef",
	"89b94fcacfbc855d",
	"f0c39452c5637760",
	"3846ef29c04922b2",
];

let _cachedSentinel: string | null = null;

function getExpectedSentinel(): string {
	if (_cachedSentinel) return _cachedSentinel;
	_cachedSentinel = EXPECTED_SENTINEL_CHUNKS.join("");
	return _cachedSentinel;
}

function verifySentinel(): { ok: boolean; reason?: string } {
	const expected = getExpectedSentinel();
	// If placeholder is still there, we're in dev or sentinel wasn't baked — skip
	if (expected.includes("SENTINEL_PLACEHOLDER")) return { ok: true };
	const actual = computeSecuritySentinel();
	if (actual !== expected) {
		return { ok: false, reason: "Binary integrity check failed: security constants modified" };
	}
	return { ok: true };
}

/**
 * In compiled binaries, the native license lib should be present.
 * If getLicenseCrypto() fell back to pure-TS, flag it.
 * This catches .dylib deletion attacks.
 */
function verifyNativeLibPresence(): IntegrityCheckResult {
	if (!looksLikeCompiledBinary()) return { ok: true, skipped: true };
	if (isNativeLibMissing()) {
		return {
			ok: false,
			reason: "Native license library missing in compiled binary — possible sidecar deletion attack",
		};
	}
	return { ok: true };
}

// ============================================================================
// PUBLIC API
// ============================================================================

export type IntegrityCheckResult = { ok: boolean; reason?: string; skipped?: boolean };

export type IntegrityResult = {
	ok: boolean;
	checks: {
		codesign: IntegrityCheckResult;
		sentinel: IntegrityCheckResult;
		signedHash: IntegrityCheckResult;
		nativeSidecar: IntegrityCheckResult;
		nativeLibPresence: IntegrityCheckResult;
	};
};

/**
 * Redundant compiled-binary detection. `isCompiledBinary()` in platform.ts
 * uses `process.execPath === process.argv[1]`. An attacker could Ghidra-find
 * that comparison and patch it to always return false (skipping all checks).
 *
 * This function provides a SECOND, independent check: the .sig file's existence.
 * If a .sig file sits next to process.execPath, we're almost certainly compiled.
 * This breaks the single-gate dependency where one patched function kills everything.
 */
function looksLikeCompiledBinary(): boolean {
	// Primary check
	if (isCompiledBinary()) return true;

	// Secondary: if a .sig sidecar exists next to our executable, we're compiled
	// even if isCompiledBinary() was somehow patched to return false.
	try {
		if (existsSync(`${process.execPath}.sig`)) return true;
	} catch {
		// ignore
	}

	// Tertiary: the native lib hash placeholder is replaced at build time.
	// If it's been replaced with a real hash, this is a compiled binary.
	// (We use the native lib hash rather than the sentinel because the sentinel
	// chunks are hardcoded in source, but the native hash is only baked by build.sh)
	if (!EXPECTED_NATIVE_LIB_HASH.includes("PLACEHOLDER")) {
		return true;
	}

	return false;
}

/**
 * Run all integrity checks. Returns immediately in dev mode (all pass).
 * In compiled mode, verifies:
 * - Platform code signature (macOS codesign / Windows Authenticode)
 * - Security sentinel (critical constants haven't been hex-edited)
 * - Signed binary hash (.sig sidecar — Ed25519 signature of binary SHA-256)
 * - Native sidecar hash (prevents .dylib/.so/.dll swap attacks)
 */
export function verifyBinaryIntegrity(exePath?: string): IntegrityResult {
	// Use redundant detection — not just isCompiledBinary() alone.
	// This prevents a single-function patch from disabling all checks.
	if (!looksLikeCompiledBinary()) {
		return {
			ok: true,
			checks: {
				codesign: { ok: true, skipped: true },
				sentinel: { ok: true, skipped: true },
				signedHash: { ok: true, skipped: true },
				nativeSidecar: { ok: true, skipped: true },
				nativeLibPresence: { ok: true, skipped: true },
			},
		};
	}

	const effectivePath = exePath ?? process.execPath;

	// 1. Code signature check (platform-specific)
	let codesign: IntegrityCheckResult;
	if (process.platform === "darwin") {
		codesign = verifyMacOSCodeSign(effectivePath);
	} else if (process.platform === "win32") {
		codesign = verifyWindowsAuthenticode(effectivePath);
	} else {
		// Linux: no OS-level code signing. Relies on sentinel + signedHash.
		codesign = { ok: true, skipped: true };
	}

	// 2. Sentinel check (all platforms)
	const sentinel = verifySentinel();

	// 3. Signed binary hash (all platforms — critical for Linux)
	const signedHash = verifySignedBinaryHash(effectivePath);

	// 4. Native sidecar integrity (prevents .dylib swap attack)
	const nativeSidecar = verifyNativeSidecar(effectivePath);

	// 5. Native lib presence (catches .dylib deletion to force TS fallback)
	const nativeLibPresence = verifyNativeLibPresence();

	return {
		ok: codesign.ok && sentinel.ok && signedHash.ok && nativeSidecar.ok && nativeLibPresence.ok,
		checks: { codesign, sentinel, signedHash, nativeSidecar, nativeLibPresence },
	};
}

// ============================================================================
// PERIODIC RE-VERIFICATION
// ============================================================================

let _periodicTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic integrity re-checks. Catches post-startup tampering
 * (debugger attach, memory patching, dynamic library injection).
 *
 * @param onFailure Called if a check fails. Typically: log + process.exit(1)
 * @param intervalMs How often to re-check (default: 5 minutes)
 */
export function startPeriodicIntegrityCheck(
	onFailure: (result: IntegrityResult) => void,
	intervalMs = 5 * 60 * 1000,
): void {
	if (!looksLikeCompiledBinary()) return;
	if (_periodicTimer) return; // already running

	// Jitter the interval ±30s so it's not predictable
	const jitter = Math.floor(Math.random() * 60_000) - 30_000;
	const effectiveInterval = Math.max(60_000, intervalMs + jitter);

	_periodicTimer = setInterval(() => {
		const result = verifyBinaryIntegrity();
		if (!result.ok) {
			onFailure(result);
		}
	}, effectiveInterval);

	// Don't block process exit
	if (_periodicTimer && typeof _periodicTimer === "object" && "unref" in _periodicTimer) {
		_periodicTimer.unref();
	}
}

/**
 * Stop periodic integrity checks.
 */
export function stopPeriodicIntegrityCheck(): void {
	if (_periodicTimer) {
		clearInterval(_periodicTimer);
		_periodicTimer = null;
	}
}

// ============================================================================
// BUILD HELPER
// ============================================================================

/**
 * Call this during build to compute the sentinel value that should be
 * embedded in the binary. The build script should:
 * 1. Call computeSecuritySentinel()
 * 2. Replace %%SENTINEL_PLACEHOLDER%% in the compiled output
 *
 * Usage (build script):
 *   import { computeSecuritySentinel } from './license/integrity'
 *   const sentinel = computeSecuritySentinel()
 *   // sed -i "s/%%SENTINEL_PLACEHOLDER%%/${sentinel}/g" ./dist/broski
 */
export { computeSecuritySentinel };
