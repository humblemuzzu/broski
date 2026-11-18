import Foundation
import os

/// The last usage report, as one JSON item in the keychain group the app shares with its widgets
/// (`BroskiWidgetsKeychainGroup` in each target's Info.plist): the app writes it, the widgets read it.
/// A keychain group, not the app group, since the team's provisioning profiles carry no App Group yet.
nonisolated struct UsageStore: Sendable {
    static let service = "com.muzammil.broski.usage"
    /// Versioned: a report of another shape is left unread rather than misread.
    private static let account = "report.v2"
    private static let log = Logger(subsystem: "com.muzammil.broski", category: "usage")

    static var shared: UsageStore {
        UsageStore(keychain: Keychain(
            service: service,
            accessGroup: Bundle.main.object(forInfoDictionaryKey: "BroskiWidgetsKeychainGroup") as? String))
    }

    let keychain: Keychain

    func load() -> UsageReport? {
        do throws(Keychain.Failure) {
            guard let data = try keychain.data(for: Self.account) else { return nil }
            return try? JSONDecoder().decode(UsageReport.self, from: data)
        } catch {
            Self.log.error("the usage report did not read: \(error.status)")
            return nil
        }
    }

    func save(_ report: UsageReport) {
        do throws(Keychain.Failure) {
            guard let data = try? JSONEncoder().encode(report) else { return }
            try keychain.set(data, for: Self.account)
        } catch {
            Self.log.error("the usage report was not saved: \(error.status)")
        }
    }
}
