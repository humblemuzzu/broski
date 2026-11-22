import SwiftUI
import WidgetKit

/// How each plan looks: its maker's mark and colour. Claude's spark in Claude's coral; Antigravity's
/// arch (its own outline, from antigravity.google) in Google's four colours; any other plan its
/// initial in slate.
extension UsagePlan {
    var tint: Color {
        switch self {
        case .claude: Color(light: 0xC15F3C, dark: 0xD97757)
        case .antigravity: Color(light: 0x1A73E8, dark: 0x5B9DFF)
        default: Color(light: 0x5B6577, dark: 0x94A3B8)
        }
    }

    /// The figure's colour: the plan's, lit up for a dark ground and deepened for a light one.
    var bright: Color {
        switch self {
        case .claude: Color(light: 0xC2522D, dark: 0xFF9B73)
        case .antigravity: Color(light: 0x2F5BEA, dark: 0x8AB4FF)
        default: Color(light: 0x475569, dark: 0xCBD5E1)
        }
    }

    /// Nil for a plan with no mark of its own, which draws its initial.
    var glyph: String? {
        switch self {
        case .claude: "AgentClaude"
        case .antigravity: "PlanAntigravity"
        default: nil
        }
    }

    /// Claude's spark is round and thin, Antigravity's arch wide and heavy: each takes the share of
    /// its frame that makes the two weigh the same.
    var glyphScale: CGFloat {
        switch self {
        case .antigravity: 0.88
        default: 1
        }
    }

    var glyphStyle: AnyShapeStyle {
        switch self {
        case .claude:
            AnyShapeStyle(Color(red: 0.851, green: 0.467, blue: 0.341))
        case .antigravity:
            AnyShapeStyle(LinearGradient(
                stops: [
                    .init(color: Color(red: 0.988, green: 0.255, blue: 0.239), location: 0.05),
                    .init(color: Color(red: 0.984, green: 0.737, blue: 0.016), location: 0.32),
                    .init(color: Color(red: 0, green: 0.725, blue: 0.361), location: 0.55),
                    .init(color: Color(red: 0.192, green: 0.525, blue: 1), location: 0.85),
                ],
                startPoint: .topTrailing, endPoint: .bottomLeading))
        default:
            AnyShapeStyle(bright)
        }
    }
}

/// The plan's mark in its own colours, or in the system's tint when the Home Screen is tinted or
/// clear and on the Lock Screen. VoiceOver reads `name`.
struct PlanGlyph: View {
    let plan: UsagePlan
    let name: String
    var size: CGFloat = 20
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        figure
            .foregroundStyle(renderingMode == .fullColor ? plan.glyphStyle : AnyShapeStyle(.primary))
            .widgetAccentable()
            .frame(width: size, height: size)
            .accessibilityLabel(name)
    }

    @ViewBuilder private var figure: some View {
        if let glyph = plan.glyph {
            Image(glyph)
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .frame(width: size * plan.glyphScale, height: size * plan.glyphScale)
        } else {
            Text(verbatim: String(name.prefix(1)).uppercased())
                .font(.system(size: size * 0.86, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.5)
        }
    }
}
