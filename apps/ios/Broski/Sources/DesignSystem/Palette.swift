import BroskiCore
import SwiftUI

/// Semantic colors. The accent is ink (`AccentColor`: near black in light, near white in dark), so
/// colour is left to meaning: orange for what needs the person, green for done, red for failed,
/// while work in progress stays neutral beside its orb. Agents wear their own colours (`AgentBrand`).
enum Palette {
    static let accent = Color.accentColor
    /// Text and symbols on an accent fill: prominent buttons draw their label white whatever the
    /// tint, which vanishes on the dark appearance's near-white ink.
    static let onAccent = Color(light: 0xFFFFFF, dark: 0x1C1C1E)
    static let needsYou = Color.orange
    static let working = Color.secondary
    static let done = Color.green
    static let failed = Color.red
    static let caution = Color.orange
    /// A line or row picked out in code, diffs and git lists.
    static let highlight = Color.blue

    /// Added and removed lines and counts in diffs and git lists, as text: darker in light mode and
    /// lighter in dark than the system green and red, which fall short of AA for small text.
    static let added = Color(light: 0x1A7F37, dark: 0x3FB950)
    static let removed = Color(light: 0xCF222E, dark: 0xF85149)

    static let card = Color(uiColor: .secondarySystemGroupedBackground)
    static let screen = Color(uiColor: .systemGroupedBackground)
}

extension InboxState {
    var title: String {
        switch self {
        case .needsYou: "Needs you"
        case .working: "Working"
        case .done: "Done"
        case .idle: "Idle"
        }
    }

    var tint: Color {
        switch self {
        case .needsYou: Palette.needsYou
        case .working: Palette.working
        case .done: Palette.done
        case .idle: .secondary
        }
    }
}
