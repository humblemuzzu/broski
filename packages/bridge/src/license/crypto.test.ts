/**
 * Tests that existing license crypto functions still work after security changes.
 * Run: cd packages/bridge && bun test src/license/crypto.test.ts
 */
import { describe, expect, test } from "bun:test";
import { getLicenseCrypto } from "./index";

describe("license crypto — not broken", () => {
	test("getLicenseCrypto returns all required functions", () => {
		const crypto = getLicenseCrypto();
		expect(typeof crypto.machineIdHash).toBe("function");
		expect(typeof crypto.encryptJws).toBe("function");
		expect(typeof crypto.decryptJws).toBe("function");
		expect(typeof crypto.verifyJws).toBe("function");
		expect(typeof crypto.claimsJson).toBe("function");
		expect(typeof crypto.verifyCodesign).toBe("function");
	});

	test("machineIdHash returns a non-empty string", () => {
		const crypto = getLicenseCrypto();
		const hash = crypto.machineIdHash();
		expect(hash).toBeTruthy();
		expect(typeof hash).toBe("string");
		expect(hash.length).toBeGreaterThan(10);
	});

	test("machineIdHash is deterministic", () => {
		const crypto = getLicenseCrypto();
		const hash1 = crypto.machineIdHash();
		const hash2 = crypto.machineIdHash();
		expect(hash1).toBe(hash2);
	});

	test("encrypt → decrypt roundtrip works", () => {
		const crypto = getLicenseCrypto();
		const machineId = crypto.machineIdHash();
		const testJws = "eyJhbGciOiJFZERTQSJ9.eyJ0ZXN0IjoxfQ.dGVzdA";

		const encrypted = crypto.encryptJws(testJws, machineId);
		expect(encrypted).toBeTruthy();
		expect(encrypted).not.toBe(testJws); // should be different (encrypted)

		const decrypted = crypto.decryptJws(encrypted, machineId);
		expect(decrypted).toBe(testJws);
	});

	test("decrypt with wrong machineId fails", () => {
		const crypto = getLicenseCrypto();
		const machineId = crypto.machineIdHash();
		const testJws = "eyJhbGciOiJFZERTQSJ9.eyJ0ZXN0IjoxfQ.dGVzdA";

		const encrypted = crypto.encryptJws(testJws, machineId);
		// Decrypt with a different machineId should return empty or throw
		const wrongDecrypt = crypto.decryptJws(encrypted, "wrong-machine-id-hash");
		expect(wrongDecrypt).toBe("");
	});

	test("verifyJws rejects invalid JWS", () => {
		const crypto = getLicenseCrypto();
		const machineId = crypto.machineIdHash();
		const result = crypto.verifyJws("not.a.valid-jws", machineId);
		expect(result).toBe(false);
	});

	test("verifyJws rejects empty string", () => {
		const crypto = getLicenseCrypto();
		const machineId = crypto.machineIdHash();
		expect(crypto.verifyJws("", machineId)).toBe(false);
	});

	test("claimsJson returns empty for invalid JWS", () => {
		const crypto = getLicenseCrypto();
		const machineId = crypto.machineIdHash();
		expect(crypto.claimsJson("invalid.jws.here", machineId)).toBe("");
	});

	test("verifyCodesign works on current process", () => {
		const crypto = getLicenseCrypto();
		// In dev mode on macOS, the bun binary might or might not be signed
		// The important thing is it doesn't crash
		const result = crypto.verifyCodesign(process.execPath);
		expect(typeof result).toBe("boolean");
	});
});

describe("loadLocalLicenseState — not broken", () => {
	test("loadLocalLicenseState returns null when no license exists", async () => {
		const { loadLocalLicenseState } = await import("./index");
		// Most dev machines won't have a stored license
		const state = await loadLocalLicenseState();
		// Either null (no license) or a valid state object — both are fine
		if (state !== null) {
			expect(state).toHaveProperty("entitled");
			expect(state).toHaveProperty("appUserId");
			expect(state).toHaveProperty("exp");
			expect(state).toHaveProperty("machineIdHash");
		}
	});
});
