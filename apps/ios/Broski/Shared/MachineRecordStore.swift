import Foundation

/// Each paired machine's `MachineRecord.toBytes()`, one item per machine id, in the access group
/// the app shares with its notification service extension (which opens pushes with the record).
nonisolated struct MachineRecordStore: Sendable {
    static let service = "com.muzammil.broski.machine"

    /// `BroskiKeychainGroup` in the target's Info.plist: `<team>.com.muzammil.broski.push`.
    static var sharedAccessGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "BroskiKeychainGroup") as? String
    }

    let keychain: Keychain

    init(keychain: Keychain = Keychain(service: service, accessGroup: sharedAccessGroup)) {
        self.keychain = keychain
    }

    func record(id: String) throws(Keychain.Failure) -> Data? {
        try keychain.data(for: id)
    }

    /// Every stored record by machine id.
    func all() throws(Keychain.Failure) -> [(id: String, bytes: Data)] {
        var records: [(id: String, bytes: Data)] = []
        for id in try keychain.accounts() {
            if let bytes = try keychain.data(for: id) { records.append((id, bytes)) }
        }
        return records
    }

    func save(_ bytes: Data, id: String) throws(Keychain.Failure) {
        try keychain.set(bytes, for: id)
    }

    func remove(id: String) throws(Keychain.Failure) {
        try keychain.remove(id)
    }
}
