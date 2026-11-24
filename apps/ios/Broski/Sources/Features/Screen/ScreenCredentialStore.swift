import BroskiCore
import Foundation
import os

/// Per-Mac Screen Sharing credentials, kept only in this iPhone's keychain and never sent to any
/// server. Forgetting a Mac removes its entry.
struct ScreenCredentialStore {
    let keychain: Keychain

    init(keychain: Keychain = Keychain(service: PhoneStorage.service, accessGroup: nil)) {
        self.keychain = keychain
    }

    func load(for machineId: String) -> ScreenCredentials? {
        do throws(Keychain.Failure) {
            guard let data = try keychain.data(for: account(for: machineId)),
                  let stored = try? JSONDecoder().decode(Stored.self, from: data),
                  !stored.password.isEmpty
            else { return nil }
            return ScreenCredentials(username: stored.username, password: stored.password)
        } catch {
            Logger.core.error("screen credentials were not read: \(error.status)")
            return nil
        }
    }

    func save(_ credentials: ScreenCredentials, for machineId: String) {
        let data = try! JSONEncoder().encode(Stored(username: credentials.username, password: credentials.password))
        do throws(Keychain.Failure) {
            try keychain.set(data, for: account(for: machineId))
        } catch {
            Logger.core.error("screen credentials were not saved: \(error.status)")
        }
    }

    func remove(for machineId: String) {
        do throws(Keychain.Failure) {
            try keychain.remove(account(for: machineId))
        } catch {
            Logger.core.error("screen credentials were not removed: \(error.status)")
        }
    }

    private func account(for machineId: String) -> String {
        "screen-credentials.\(machineId)"
    }

    private struct Stored: Codable {
        let username: String
        let password: String
    }
}
