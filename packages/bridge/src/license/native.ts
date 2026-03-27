import { dlopen, FFIType } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type NativeLicense = {
	libPath: string;
	machineIdHash: () => string;
	encryptJws: (jws: string, machineIdHash: string) => string;
	decryptJws: (enc: string, machineIdHash: string) => string;
	verifyJws: (jws: string, machineIdHash: string) => boolean;
	claimsJson: (jws: string, machineIdHash: string) => string;
	verifyCodesign: (exePath: string) => boolean;
};

function getLibFilename(): string {
	if (process.platform === "win32") return "broski_license.dll";
	if (process.platform === "darwin") return "libbroski_license.dylib";
	return "libbroski_license.so";
}

function findNativeLibPath(): string | null {
	const name = getLibFilename();

	// Compiled binary: the native lib is shipped alongside the executable.
	try {
		const compiledDir = dirname(process.execPath);
		const candidate = resolve(compiledDir, name);
		if (existsSync(candidate)) return candidate;
	} catch {
		// ignore
	}

	// Dev mode: load from repo build output.
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const base = resolve(here, "..", "..", "native", "license", "target");
		const candidates: string[] = [
			resolve(base, "release", name), // cargo build --release (no --target)
		];

		// cargo build --release --target <triple>
		// Common host triples for our supported platforms.
		if (process.platform === "darwin") {
			candidates.push(resolve(base, "aarch64-apple-darwin", "release", name));
			candidates.push(resolve(base, "x86_64-apple-darwin", "release", name));
		} else if (process.platform === "linux") {
			candidates.push(resolve(base, "x86_64-unknown-linux-gnu", "release", name));
			candidates.push(resolve(base, "aarch64-unknown-linux-gnu", "release", name));
		} else if (process.platform === "win32") {
			candidates.push(resolve(base, "x86_64-pc-windows-msvc", "release", name));
		}

		for (const candidate of candidates) {
			if (existsSync(candidate)) return candidate;
		}
	} catch {
		// ignore
	}

	return null;
}

// Helper to convert JS string to null-terminated Buffer for FFI
function toCString(str: string): Buffer {
	return Buffer.from(`${str}\0`, "utf8");
}

export function loadNativeLicense(): NativeLicense | null {
	const libPath = findNativeLibPath();
	if (!libPath) return null;

	try {
		const lib = dlopen(libPath, {
			broski_machine_id_hash: { args: [], returns: FFIType.cstring },
			broski_license_encrypt_jws: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.cstring },
			broski_license_decrypt_jws: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.cstring },
			broski_license_verify_jws: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
			broski_license_claims_json: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.cstring },
			broski_verify_codesign: { args: [FFIType.ptr], returns: FFIType.i32 },
		});

		return {
			libPath,
			machineIdHash: () => String(lib.symbols.broski_machine_id_hash()),
			encryptJws: (jws, machineIdHash) =>
				String(lib.symbols.broski_license_encrypt_jws(toCString(jws), toCString(machineIdHash))),
			decryptJws: (enc, machineIdHash) =>
				String(lib.symbols.broski_license_decrypt_jws(toCString(enc), toCString(machineIdHash))),
			verifyJws: (jws, machineIdHash) =>
				Number(lib.symbols.broski_license_verify_jws(toCString(jws), toCString(machineIdHash))) === 1,
			claimsJson: (jws, machineIdHash) =>
				String(lib.symbols.broski_license_claims_json(toCString(jws), toCString(machineIdHash))),
			verifyCodesign: (exePath) => Number(lib.symbols.broski_verify_codesign(toCString(exePath))) === 1,
		};
	} catch (err) {
		// If native library loading or FFI setup fails, fall back to pure-TS implementation
		console.warn(`[License] Native library load failed, using fallback: ${err}`);
		return null;
	}
}
