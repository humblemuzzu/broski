import SwiftUI

/// Local preferences, kept in `UserDefaults` (`@AppStorage`) under these keys.
enum Preference {
    static let appearance = "appearance"
    /// Which notifications the person wants; the notifications feature reads them before showing one.
    static let notifyNeedsYou = "notifications.needsYou"
    static let notifyDone = "notifications.done"
    static let notifyFailures = "notifications.failures"
}

enum Appearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: Self { self }

    var title: LocalizedStringKey {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
