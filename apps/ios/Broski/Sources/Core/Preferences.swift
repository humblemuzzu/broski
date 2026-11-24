import SwiftUI

enum Preference {
    static let appearance = "appearance"
    static let keepScreenAwake = "display.keepScreenAwake"
    static let terminalFontSize = "terminal.fontSize"
    static let collapsesWork = "chat.collapsesWork"
    static let readingSize = "reading.size"
    static let readingCompact = "reading.compact"
    static let readingDensity = "reading.density"
    static let readingFont = "reading.font"
    static let readingInlineCode = "reading.inlineCode"
    static let readingDarkCanvas = "reading.darkCanvas"
    static let readingWrapsCode = "reading.wrapsCode"
    static let readingUnderlinesLinks = "reading.underlinesLinks"
    static let modelPins = "models.pinned"
    static let modelLevels = "models.levels"
    static let inboxAgent = "inbox.agent"
    static let inboxMachine = "inbox.machine"
    static let inboxFolder = "inbox.folder"
    static let remoteScreen = "experimental.remoteScreen"
}

enum KeepScreenAwake: String, CaseIterable, Identifiable {
    case dictationOnly
    case whileWorking
    case always

    var id: Self { self }

    var title: String {
        switch self {
        case .dictationOnly: "Only while dictating"
        case .whileWorking: "While agents are working"
        case .always: "Always while open"
        }
    }

    static func current(in defaults: UserDefaults = .standard) -> KeepScreenAwake {
        defaults.string(forKey: Preference.keepScreenAwake).flatMap(KeepScreenAwake.init(rawValue:)) ?? .dictationOnly
    }
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

nonisolated enum ReadingDensity: String, CaseIterable, Identifiable {
    case compact
    case balanced
    case airy

    var id: Self { self }

    var title: String {
        switch self {
        case .compact: "Compact"
        case .balanced: "Balanced"
        case .airy: "Airy"
        }
    }

    var spacingMultiplier: CGFloat {
        switch self {
        case .compact: 0.78
        case .balanced: 1.0
        case .airy: 1.22
        }
    }

    var lineSpacingMultiplier: CGFloat {
        switch self {
        case .compact: 0.72
        case .balanced: 1.0
        case .airy: 1.24
        }
    }
}

nonisolated enum ReadingFont: String, CaseIterable, Identifiable {
    case system
    case serif
    case rounded
    case mono

    var id: Self { self }

    var title: String {
        switch self {
        case .system: "Sans"
        case .serif: "Serif"
        case .rounded: "Rounded"
        case .mono: "Mono"
        }
    }

    var design: Font.Design {
        switch self {
        case .system: .default
        case .serif: .serif
        case .rounded: .rounded
        case .mono: .monospaced
        }
    }
}

nonisolated enum InlineCodeStyle: String, CaseIterable, Identifiable {
    case plain
    case tinted

    var id: Self { self }

    var title: String {
        switch self {
        case .plain: "Clean"
        case .tinted: "Subtle Tint"
        }
    }
}

nonisolated enum DarkCanvas: String, CaseIterable, Identifiable {
    case pureBlack
    case charcoal

    var id: Self { self }

    var title: String {
        switch self {
        case .pureBlack: "True Black"
        case .charcoal: "Charcoal"
        }
    }
}
