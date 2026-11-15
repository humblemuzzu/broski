import SwiftUI

/// Local preferences, kept in `UserDefaults` (`@AppStorage`) under these keys. Which notifications
/// the person wants are `NotificationPreferences`, in the app group the extension reads.
enum Preference {
    static let appearance = "appearance"
    /// The terminal's font size in points as last pinched; 0 until then (Ghostty's own default).
    static let terminalFontSize = "terminal.fontSize"
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
