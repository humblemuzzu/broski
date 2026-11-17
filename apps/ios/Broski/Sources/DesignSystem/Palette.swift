import BroskiCore
import SwiftUI

/// Semantic colors. The accent (calm blue-violet, `AccentColor` in the asset catalog, tuned for
/// AA contrast in light and dark) marks what needs the person; agents wear their own colours (`AgentBrand`).
enum Palette {
    static let accent = Color.accentColor
    static let needsYou = Color.accentColor
    static let working = Color.blue
    static let done = Color.green
    static let failed = Color.red
    static let caution = Color.orange

    /// Added and removed lines and counts in diffs and git lists, as text: darker in light mode and
    /// lighter in dark than the system green and red, which fall short of AA for small text.
    static let added = Color(light: 0x1A7F37, dark: 0x3FB950)
    static let removed = Color(light: 0xCF222E, dark: 0xF85149)

    static let card = Color(uiColor: .secondarySystemGroupedBackground)
    static let screen = Color(uiColor: .systemGroupedBackground)
}

extension Color {
    /// A color for each appearance, from `0xRRGGBB`.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let rgb = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat(rgb >> 16 & 0xFF) / 255, green: CGFloat(rgb >> 8 & 0xFF) / 255,
                blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
        })
    }
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

    var brand: AgentBrand {
        switch self {
        case .claudeCode: .claudeCode
        case .pi: .pi
        }
    }
}
