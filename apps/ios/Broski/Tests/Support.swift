import Foundation

@testable import Broski

/// The fixtures `packages/link/mobile/tests/facade.rs` describes, read from the checkout (the
/// simulator reads the host's files): a daemon-written offer for "Studio Mac" whose one LAN route,
/// 127.0.0.1:9, refuses every connection, and the stored record of that pairing.
enum Fixture {
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appending(path: "../../../../packages/link/mobile/tests/fixtures")
        .standardizedFileURL

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appending(path: name))
    }

    static func text(_ name: String) throws -> String {
        String(decoding: try data(name), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Storage under keychain services no other test or the app itself uses, removed when done.
struct TestStorage {
    let storage: PhoneStorage

    init() {
        let tag = UUID().uuidString
        storage = PhoneStorage(
            app: Keychain(service: "com.muzammil.broski.tests.\(tag)", accessGroup: nil),
            records: MachineRecordStore(
                keychain: Keychain(
                    service: "com.muzammil.broski.tests.machine.\(tag)",
                    accessGroup: MachineRecordStore.sharedAccessGroup)))
    }

    func remove() {
        try? storage.removeEverything()
    }
}
