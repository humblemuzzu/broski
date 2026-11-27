import SwiftUI
import WidgetKit

/// How each plan looks: its maker's mark and colour. Claude's spark in Claude's coral; any other
/// plan its initial in slate.
extension UsagePlan {
    var tint: Color {
        switch self {
        case .claude: Color(light: 0xC15F3C, dark: 0xD97757)
        default: Color(light: 0x5B6577, dark: 0x94A3B8)
        }
    }

    /// The figure's colour: the plan's, lit up for a dark ground and deepened for a light one.
    var bright: Color {
        switch self {
        case .claude: Color(light: 0xC2522D, dark: 0xFF9B73)
        default: Color(light: 0x475569, dark: 0xCBD5E1)
        }
    }

    /// The maker's agent, whose mark the plan wears; nil for a plan with no mark of its own, which
    /// draws its initial.
    var logo: AgentBrand.Logo? {
        switch self {
        case .claude: .claude
        default: nil
        }
    }

    var glyphStyle: AnyShapeStyle {
        logo?.ink ?? AnyShapeStyle(bright)
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
        if let logo = plan.logo {
            Image(logo.glyph)
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
        } else {
            Text(verbatim: String(name.prefix(1)).uppercased())
                .font(.system(size: size * 0.86, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.5)
        }
    }
}
