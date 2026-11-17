import SwiftUI

/// The two agents as Broski draws them everywhere, in the app and in the Live Activity: each
/// one's own logo, white on its maker's colour.
nonisolated enum AgentBrand: Sendable {
    case claudeCode
    case pi

    /// From the contract's wire name, `claude-code` or `pi`.
    init(wire: String) {
        self = wire == "pi" ? .pi : .claudeCode
    }

    var name: String {
        switch self {
        case .claudeCode: "Claude Code"
        case .pi: "Pi"
        }
    }

    var glyph: String {
        switch self {
        case .claudeCode: "AgentClaude"
        case .pi: "AgentPi"
        }
    }

    /// Claude's spark is round and thin, Pi's blocks are square and heavy, so the spark takes more
    /// of the tile for the two to weigh the same.
    var glyphShare: CGFloat {
        switch self {
        case .claudeCode: 0.66
        case .pi: 0.46
        }
    }

    /// The logo's own colour, for the glyph drawn on black without its tile.
    var ink: Color {
        switch self {
        case .claudeCode: Color(red: 0.851, green: 0.467, blue: 0.341)
        case .pi: .white
        }
    }

    var fill: LinearGradient {
        let (top, bottom): (Color, Color) = switch self {
        case .claudeCode: (Color(red: 0.890, green: 0.545, blue: 0.424), Color(red: 0.776, green: 0.384, blue: 0.259))
        case .pi: (Color(red: 0.200, green: 0.212, blue: 0.333), Color(red: 0.086, green: 0.098, blue: 0.165))
        }
        return LinearGradient(colors: [top, bottom], startPoint: .top, endPoint: .bottom)
    }
}

/// An agent's logo in a continuous-corner tile of `side` points; VoiceOver reads its name.
struct AgentLogo: View {
    let brand: AgentBrand
    let side: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: side * 0.28, style: .continuous)
        Image(brand.glyph)
            .resizable()
            .renderingMode(.template)
            .scaledToFit()
            .foregroundStyle(.white)
            .frame(width: side * brand.glyphShare, height: side * brand.glyphShare)
            .frame(width: side, height: side)
            .background(brand.fill, in: shape)
            .overlay { shape.strokeBorder(.white.opacity(0.14), lineWidth: max(0.5, side / 80)) }
            .accessibilityElement()
            .accessibilityLabel(brand.name)
    }
}

/// The logo alone in its own colour, for the Dynamic Island's black.
struct AgentGlyph: View {
    let brand: AgentBrand
    let side: CGFloat

    var body: some View {
        Image(brand.glyph)
            .resizable()
            .renderingMode(.template)
            .scaledToFit()
            .foregroundStyle(brand.ink)
            .frame(width: side * (brand.glyphShare + 0.2), height: side * (brand.glyphShare + 0.2))
            .frame(width: side, height: side)
            .accessibilityLabel(brand.name)
    }
}
