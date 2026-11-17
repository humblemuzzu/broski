import Foundation
import os

/// Dictation's settings: the xAI key in the app's keychain, the rest in `UserDefaults`
/// (`@AppStorage`) under these keys.
nonisolated enum VoicePreference {
    /// An xAI language code, or `VoiceLanguage.detect`.
    static let language = "voice.language"
    static let sendAfterDictating = "voice.sendAfterDictating"
    static let projectWords = "voice.projectWords"
    /// The person's own words, one per line.
    static let dictionary = "voice.dictionary"
}

nonisolated enum VoiceLanguage {
    static let detect = "detect"
    static let standard = "en"
}

/// What a recording goes out with, read when it does.
nonisolated struct VoiceSettings: Equatable, Sendable {
    var language: String?
    var sendAfterDictating: Bool
    var projectWords: Bool
    var dictionary: [String]

    static func current(_ defaults: UserDefaults = .standard) -> VoiceSettings {
        let language = defaults.string(forKey: VoicePreference.language) ?? VoiceLanguage.standard
        return VoiceSettings(
            language: language == VoiceLanguage.detect ? nil : language,
            sendAfterDictating: defaults.bool(forKey: VoicePreference.sendAfterDictating),
            projectWords: defaults.object(forKey: VoicePreference.projectWords) as? Bool ?? true,
            dictionary: words(defaults.string(forKey: VoicePreference.dictionary) ?? ""))
    }

    static func words(_ stored: String) -> [String] {
        stored.split(separator: "\n").map { String($0).trimmed }.filter { !$0.isEmpty }
    }
}

/// The xAI key, kept only in this phone's keychain and sent only to xAI.
struct VoiceKeyStore {
    private static let account = "xai-api-key"
    let keychain: Keychain

    init(keychain: Keychain = Keychain(service: PhoneStorage.service, accessGroup: nil)) {
        self.keychain = keychain
    }

    /// `nil` when none is saved; a keychain that cannot be read counts as none, and is logged.
    func key() -> String? {
        do throws(Keychain.Failure) {
            guard let data = try keychain.data(for: Self.account) else { return nil }
            return String(data: data, encoding: .utf8).map(\.trimmed).flatMap { $0.isEmpty ? nil : $0 }
        } catch {
            Logger.core.error("the xAI key was not read: \(error.status)")
            return nil
        }
    }

    func save(_ key: String) throws(Keychain.Failure) {
        try keychain.set(Data(key.trimmed.utf8), for: Self.account)
    }

    func remove() throws(Keychain.Failure) {
        try keychain.remove(Self.account)
    }

    /// `xai-…7Q2f`: enough to tell keys apart, never the key.
    static func masked(_ key: String) -> String {
        let prefix = key.split(separator: "-").first.map { "\($0)-" } ?? ""
        return "\(prefix)…\(key.suffix(4))"
    }
}
