import CryptoKit
import Foundation

/// The push crypto, shared by the app and its notification extension.
///
/// Per machine the phone holds one random 32-byte key K; two HMAC labels
/// derive the keys pushes and letters are sealed with, and ChaCha20-Poly1305
/// binds every body to the machine it is for.
enum NotificationCrypto {
  static let notifyKeyLabel = "broski-notify-v1"
  static let letterKeyLabel = "broski-letter-v1"

  static func notifyKey(masterKey: Data) -> SymmetricKey {
    derivedKey(notifyKeyLabel, masterKey: masterKey)
  }

  static func letterKey(masterKey: Data) -> SymmetricKey {
    derivedKey(letterKeyLabel, masterKey: masterKey)
  }

  private static func derivedKey(_ label: String, masterKey: Data) -> SymmetricKey {
    let mac = HMAC<SHA256>.authenticationCode(
      for: Data(label.utf8),
      using: SymmetricKey(data: masterKey)
    )
    return SymmetricKey(data: Data(mac))
  }

  /// Opens a sealed body: `nonce ‖ ciphertext ‖ tag`, or nil when it is not
  /// one, or when the tag does not authenticate.
  static func open(_ sealed: Data, key: SymmetricKey, aad: Data) -> Data? {
    guard let box = try? ChaChaPoly.SealedBox(combined: sealed) else { return nil }
    return try? ChaChaPoly.open(box, using: key, authenticating: aad)
  }

  static func seal(
    _ plaintext: Data,
    key: SymmetricKey,
    nonce: ChaChaPoly.Nonce,
    aad: Data
  ) -> Data? {
    try? ChaChaPoly.seal(plaintext, using: key, nonce: nonce, authenticating: aad).combined
  }

  /// A lock-screen decision, sealed with the machine's letter key.
  static func sealLetter(_ plaintext: Data, masterKey: Data, aad: Data) -> Data? {
    seal(
      plaintext,
      key: letterKey(masterKey: masterKey),
      nonce: ChaChaPoly.Nonce(),
      aad: aad
    )
  }

  /// 16 random bytes as 32 lowercase hex characters.
  static func randomID() -> String {
    (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
  }

  static func decodeBase64URL(_ value: String) -> Data? {
    var padded = value
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    padded += String(repeating: "=", count: (4 - padded.count % 4) % 4)
    return Data(base64Encoded: padded)
  }
}
