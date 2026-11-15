import BroskiCore
import SwiftUI

/// Semantic colors. The accent (calm blue-violet, `AccentColor` in the asset catalog, tuned for
/// AA contrast in light and dark) marks what needs the person; agent marks stay neutral.
enum Palette {
    static let accent = Color.accentColor
    static let needsYou = Color.accentColor
    static let working = Color.blue
    static let done = Color.green
    static let failed = Color.red
    static let caution = Color.orange

    static let markFill = Color(uiColor: .tertiarySystemFill)
    static let markInk = Color.primary.opacity(0.72)
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

extension BackendId {
    /// The agent's name, exactly as its makers write it.
    var displayName: String {
        switch self {
        case .claudeCode: "Claude Code"
        case .pi: "Pi"
        }
    }

    /// The monogram the agent mark shows (never a brand logo).
    var monogram: String {
        switch self {
        case .claudeCode: "CC"
        case .pi: "Pi"
        }
    }
}
