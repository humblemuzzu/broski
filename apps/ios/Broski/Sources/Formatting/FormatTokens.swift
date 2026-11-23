import BroskiCore
import SwiftUI

nonisolated enum FormatTokens {
    static let readableWidth: CGFloat = 680
    static let quoteBarWidth: CGFloat = 2
    static let quoteGap: CGFloat = 12
    static let calloutRadius: CGFloat = 10
    static let calloutBarWidth: CGFloat = 3
    static let calloutPadding: CGFloat = 12
    /// Clean diminishing per-level list indents (depths 1, 2, 3+); capped at 42 pt, no guide lines.
    static let listIndentSteps: [CGFloat] = [16, 14, 12]
    static let bulletBoxWidth: CGFloat = 7
    static let bulletGap: CGFloat = 9
    static let numberGap: CGFloat = 6
    static let taskGutter: CGFloat = 16
    static let taskGap: CGFloat = 8
    static let codeSize: CGFloat = 13.5
    static let inlineCodeScale: CGFloat = 0.90
    static let inlineCodeRadius: CGFloat = 5
    static let imageChipFill = Color(light: UIColor(white: 0, alpha: 0.055), dark: UIColor(white: 1, alpha: 0.08))
    static let cardBorder = Color(light: UIColor(white: 0, alpha: 0.08), dark: UIColor(white: 1, alpha: 0.09))
    static let ruleColor = Color(light: UIColor(white: 0, alpha: 0.09), dark: UIColor(white: 1, alpha: 0.10))
    static let bulletPrimary = Color(light: UIColor(white: 0.15, alpha: 0.72), dark: UIColor(white: 0.90, alpha: 0.76))
    static let bulletNested = Color(light: UIColor(white: 0.20, alpha: 0.50), dark: UIColor(white: 0.85, alpha: 0.50))
    static let markerColor = Color(light: UIColor(white: 0.20, alpha: 0.58), dark: UIColor(white: 0.85, alpha: 0.60))
    static let codeRadius: CGFloat = 10
    static let codeFoldLines = 30
    static let codeCountLines = 10
    static let tableRadius: CGFloat = 10
    static let tableCellPadding = EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
    static let tableMinColumn: CGFloat = 56
    static let tableMaxMinColumn: CGFloat = 192
    static let tableScrollColumn: CGFloat = 236
    static let menuLinks = 5
    static let tableEdgeFade: CGFloat = 28
    static let tableFoldRows = 12
    static let tableShownRows = 10
    static let keyColumnShare: CGFloat = 0.4
    static let arrival: Double = 0.15

    static func listBaseIndent(depth: Int) -> CGFloat {
        let clamped = min(max(depth, 0), listIndentSteps.count)
        return listIndentSteps.prefix(clamped).reduce(0, +)
    }

    static func spacing(_ step: FormatSpacing, quiet: Bool = false, compact: Bool = false) -> CGFloat {
        let points: CGFloat = switch step {
        case .none: 0
        case .tight: 10
        case .afterHeading: 10
        case .leadIn: 10
        case .stackedHeading: 12
        case .loose, .afterGroup: 14
        case .paragraph: 16
        case .block: 18
        case .rule: 20
        case .subSection: 22
        case .section: 28
        }
        return points * (quiet ? 0.75 : 1) * (compact ? 0.78 : 1)
    }
}

nonisolated struct HeadingSpec: Equatable {
    let size: CGFloat
    let weight: Font.Weight
    let lineSpacing: CGFloat
    let tracking: CGFloat
}

nonisolated enum FormatRole: Equatable {
    case page
    case quiet

    var textStyle: Font.TextStyle {
        switch self {
        case .page: .body
        case .quiet: .subheadline
        }
    }

    var baseSize: CGFloat {
        switch self {
        case .page: 16
        case .quiet: 14.5
        }
    }

    var lineSpacing: CGFloat {
        switch self {
        case .page: 5.0
        case .quiet: 3.5
        }
    }

    var style: HierarchicalShapeStyle {
        switch self {
        case .page: .primary
        case .quiet: .secondary
        }
    }

    func heading(_ level: UInt8) -> HeadingSpec {
        switch (self, level) {
        case (.page, 1): HeadingSpec(size: 21, weight: .semibold, lineSpacing: 2.5, tracking: -0.3)
        case (.page, 2): HeadingSpec(size: 18.5, weight: .semibold, lineSpacing: 2.5, tracking: -0.2)
        case (.page, 3): HeadingSpec(size: 16.5, weight: .semibold, lineSpacing: 2.5, tracking: -0.1)
        case (.page, _): HeadingSpec(size: 15.5, weight: .semibold, lineSpacing: 3.0, tracking: 0)
        case (.quiet, 1): HeadingSpec(size: 15.5, weight: .semibold, lineSpacing: 2.0, tracking: -0.1)
        case (.quiet, _): HeadingSpec(size: 14.5, weight: .semibold, lineSpacing: 2.0, tracking: 0)
        }
    }
}

extension FormatTokens {
    @MainActor static let link = Color(light: 0x1D4ED8, dark: 0x60A5FA)
    static let bodyText = Color(light: UIColor(red: 0.11, green: 0.11, blue: 0.13, alpha: 0.90), dark: UIColor(red: 0.85, green: 0.85, blue: 0.89, alpha: 1))
    static let boldText = Color(light: UIColor(white: 0.04, alpha: 1), dark: UIColor(white: 1, alpha: 1))
    static let inlineCodeText = Color(light: UIColor(red: 0.22, green: 0.25, blue: 0.31, alpha: 1), dark: UIColor(red: 0.78, green: 0.83, blue: 0.90, alpha: 1))
    static let quoteText = Color(light: UIColor(white: 0.18, alpha: 0.72), dark: UIColor(red: 0.75, green: 0.75, blue: 0.80, alpha: 0.80))
    @MainActor static let path = Color(light: 0x0F766E, dark: 0x6EC8BC)
    static let tableRowHairline = Color(light: UIColor(white: 0, alpha: 0.08), dark: UIColor(white: 1, alpha: 0.09))
    static let tableHeaderHairline = Color(light: UIColor(white: 0, alpha: 0.14), dark: UIColor(white: 1, alpha: 0.15))
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
