import Foundation
import Security

/// One machine's push credentials, as the app wrote them into the shared
/// keychain group.
struct PushKeychainItem: Decodable {
  let machineID: String
  let machineName: String
  let relay: String?
  let deviceID: String
  let relayToken: String?
  let key: String

  enum CodingKeys: String, CodingKey {
    case machineID = "machine_id"
    case machineName = "machine_name"
    case relay
    case deviceID = "device_id"
    case relayToken = "relay_token"
    case key
  }
}

enum PushKeychain {
  /// The access group both entitlements files declare, expanded at build time.
  static var accessGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "BroskiKeychainGroup") as? String
  }

  /// Reads the item `push_key_store.dart` writes for one machine: a generic
  /// password under flutter_secure_storage's default service.
  static func item(machineID: String) -> PushKeychainItem? {
    guard let group = accessGroup else { return nil }
    let query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: "flutter_secure_storage_service",
      kSecAttrAccount: "broski_push_\(machineID)",
      kSecAttrAccessGroup: group,
      kSecReturnData: true,
      kSecMatchLimit: kSecMatchLimitOne,
    ]
    var found: CFTypeRef?
    guard
      SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess,
      let data = found as? Data
    else { return nil }
    return try? JSONDecoder().decode(PushKeychainItem.self, from: data)
  }
}
