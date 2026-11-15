import Foundation
import Security

/// Generic-password items under one service, in one access group (`nil`: the app's own, the first
/// group its entitlements list). Compiled into the app and its notification service extension.
nonisolated struct Keychain: Sendable {
    let service: String
    let accessGroup: String?

    struct Failure: Error, Equatable {
        let status: OSStatus
    }

    func data(for account: String) throws(Failure) -> Data? {
        var query = base(account: account)
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var found: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &found)
        switch status {
        case errSecSuccess: return found as? Data
        case errSecItemNotFound: return nil
        default: throw Failure(status: status)
        }
    }

    /// Items are readable after the first unlock, so a push handled on a locked phone can open
    /// them, and never leave this device through a backup.
    func set(_ data: Data, for account: String) throws(Failure) {
        let update: [CFString: Any] = [
            kSecValueData: data,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(base(account: account) as CFDictionary, update as CFDictionary)
        switch status {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            let added = SecItemAdd(base(account: account).merging(update) { $1 } as CFDictionary, nil)
            guard added == errSecSuccess else { throw Failure(status: added) }
        default:
            throw Failure(status: status)
        }
    }

    func remove(_ account: String) throws(Failure) {
        let status = SecItemDelete(base(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw Failure(status: status)
        }
    }

    func accounts() throws(Failure) -> [String] {
        var query = base(account: nil)
        query[kSecReturnAttributes] = true
        query[kSecMatchLimit] = kSecMatchLimitAll
        var found: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &found)
        switch status {
        case errSecSuccess:
            let items = found as? [[CFString: Any]] ?? []
            return items.compactMap { $0[kSecAttrAccount] as? String }.sorted()
        case errSecItemNotFound:
            return []
        default:
            throw Failure(status: status)
        }
    }

    private func base(account: String?) -> [CFString: Any] {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
        ]
        if let account { query[kSecAttrAccount] = account }
        if let accessGroup { query[kSecAttrAccessGroup] = accessGroup }
        return query
    }
}
