import BroskiCore
import SwiftUI

/// Every measure the formatter draws with, in one place; Android's `FormatTokens.kt` holds the same
/// table so the two apps cannot drift (docs/rebuild/formatting-plan.md §5).
nonisolated enum FormatTokens {
    /// Prose wider than this reads badly; in landscape and on iPad it is centred at this width.
    static let readableWidth: CGFloat = 680
    static let quoteBarWidth: CGFloat = 3
    static let quoteGap: CGFloat = 12
    static let calloutRadius: CGFloat = 12
    static let calloutPadding: CGFloat = 14
    /// Lists indent no deeper than this, so a phone keeps its width.
    static let maxListIndent: UInt32 = 4
    static let bulletGutter: CGFloat = 14
    static let markerGap: CGFloat = 6
    static let codeSize: CGFloat = 14
    static let inlineCodeScale: CGFloat = 0.85
    static let codeRadius: CGFloat = 12
    /// A code block past this many lines folds; its header counts lines past `codeCountLines`.
    static let codeFoldLines = 30
    static let codeCountLines = 10
    static let tableRadius: CGFloat = 12
    static let tableCellPadding = EdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)
    static let tableMinColumn: CGFloat = 56
    static let tableMaxMinColumn: CGFloat = 200
    static let tableScrollColumn: CGFloat = 240
    /// A table past `tableFoldRows` rows shows `tableShownRows` and a button for the rest.
    static let tableFoldRows = 12
    static let tableShownRows = 10
    /// A key/value table's labels take at most this share of the width.
    static let keyColumnShare: CGFloat = 0.4
    /// How long a new block takes to fade in while an answer streams.
    static let arrival: Double = 0.15

    /// The space before a block, by its step, for the answer's size; quiet text is tighter.
    static func spacing(_ step: FormatSpacing, quiet: Bool = false, compact: Bool = false) -> CGFloat {
        let points: CGFloat = switch step {
        case .none: 0
        case .tight: 4
        case .loose: 10
        case .afterHeading: 8
        case .paragraph: 12
        case .section: 24
        }
        return points * (quiet ? 0.75 : 1) * (compact ? 0.75 : 1)
    }
}

/// Where agent-authored text is drawn, which sets its size and emphasis: `page` for the answer the
/// person reads (the transcript, a plan, a report opened whole), `quiet` for what sits under a row
/// (thinking, a subagent's or an activity's text, a tool's report).
nonisolated enum FormatRole: Equatable {
    case page
    case quiet

    var textStyle: Font.TextStyle {
        switch self {
        case .page: .body
        case .quiet: .subheadline
        }
    }

    /// The text size at the default Dynamic Type size: what scaled measures start from.
    var baseSize: CGFloat {
        switch self {
        case .page: 17
        case .quiet: 15
        }
    }

    /// Extra space between lines, so body text reads at about 1.45 times its size.
    var lineSpacing: CGFloat {
        switch self {
        case .page: 4.5
        case .quiet: 3
        }
    }

    var style: HierarchicalShapeStyle {
        switch self {
        case .page: .primary
        case .quiet: .secondary
        }
    }

    /// H1 22 bold, H2 20 semibold, H3 at body size semibold (never smaller), H4–H6 the same in
    /// the secondary colour.
    func headingFont(_ level: UInt8) -> Font {
        switch (self, level) {
        case (.page, 1): .title2.weight(.bold)
        case (.page, 2): .title3.weight(.semibold)
        case (.page, _): .body.weight(.semibold)
        case (.quiet, 1): .headline
        case (.quiet, _): .subheadline.weight(.semibold)
        }
    }
}

extension FormatTokens {
    /// Links in one blue, never the accent or the wallpaper's colour, AA on either background.
    @MainActor static let link = Color(light: 0x1D4ED8, dark: 0x60A5FA)
    @MainActor static let inlineCodeFill = Color(uiColor: .tertiarySystemFill)
    @MainActor static let tableHeaderFill = Color(uiColor: .secondarySystemFill).opacity(0.6)
    @MainActor static let hairline = Color(uiColor: .separator)
}

extension CalloutKind {
    @MainActor var tint: Color {
        switch self {
        case .note: Color(light: 0x0969DA, dark: 0x4493F8)
        case .tip: Color(light: 0x1A7F37, dark: 0x3FB950)
        case .important: Color(light: 0x8250DF, dark: 0xAB7DF8)
        case .warning: Color(light: 0x9A6700, dark: 0xD29922)
        case .caution: Color(light: 0xCF222E, dark: 0xF85149)
        case .insight: Color(light: 0xBC4C00, dark: 0xF0883E)
        }
    }

    var symbol: String {
        switch self {
        case .note: "info.circle.fill"
        case .tip: "lightbulb.fill"
        case .important: "exclamationmark.bubble.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .caution: "octagon.fill"
        case .insight: "star.fill"
        }
    }

    var title: String {
        switch self {
        case .note: "Note"
        case .tip: "Tip"
        case .important: "Important"
        case .warning: "Warning"
        case .caution: "Caution"
        case .insight: "Insight"
        }
    }
}
