import SwiftUI

/// An agent as Broski draws it everywhere, in the app and in the Live Activity: Claude Code's and
/// Pi's own logos white on their makers' colours, any other agent its initials on the accent its
/// bridge names, slate when it names none.
nonisolated struct AgentBrand: Codable, Hashable, Sendable {
    enum Logo: String, Codable, Sendable {
        case claude
        case pi

        init?(backend: String) {
            switch backend {
            case "claude-code": self = .claude
            case "pi": self = .pi
            default: return nil
            }
        }
    }

    let name: String
    /// Nil draws the monogram.
    let logo: Logo?
    /// `#RRGGBB`, as the bridge's descriptor gives it.
    let accentHex: String?

    /// What the phone knows of an agent its bridge has not described: a name read from its id, and
    /// Claude Code's and Pi's logos.
    init(backend: String) {
        self.init(backend: backend, name: nil, accentHex: nil, logo: Logo(backend: backend))
    }

    init(backend: String, name: String?, accentHex: String?, logo: Logo?) {
        let named = name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.init(name: named.isEmpty ? Slug.label(backend) : named, logo: logo, accentHex: accentHex)
    }

    private init(name: String, logo: Logo?, accentHex: String?) {
        self.name = name
        self.logo = logo
        self.accentHex = accentHex
    }

    /// Small enough for ActivityKit's 4 KB state whatever the bridge sent: the name cut to
    /// `maxNameLength` Unicode scalars, which bounds its bytes in any script, and an accent kept
    /// only when it is one.
    func capped(maxNameLength: Int = 40) -> AgentBrand {
        AgentBrand(
            name: String(String.UnicodeScalarView(name.unicodeScalars.prefix(maxNameLength))), logo: logo,
            accentHex: accentHex.flatMap { RGB(hex: $0) == nil ? nil : $0 })
    }

    /// The first letters of the name's first two words: "My Agent" is "MA", "Codex" is "C".
    var initials: String {
        let letters = name.split { !$0.isLetter && !$0.isNumber }.prefix(2).compactMap(\.first)
        return letters.isEmpty ? String(name.prefix(1)) : String(letters).uppercased()
    }

    var accent: RGB { accentHex.flatMap(RGB.init(hex:)) ?? .slate }

    /// The figure's colour on the tile: white on the logos, else whichever of white and near black
    /// stands out more from the accent.
    var tileInk: Color {
        logo == nil && accent.prefersDarkInk ? Color.black.opacity(0.78) : .white
    }

    /// The figure's own colour, for the glyph drawn on black without its tile.
    var ink: Color {
        switch logo {
        case .claude: Color(red: 0.851, green: 0.467, blue: 0.341)
        case .pi: .white
        case nil: (accent.luminance < 0.35 ? accent.mixed(with: .white, 0.45) : accent).color
        }
    }

    var fill: LinearGradient {
        let (top, bottom): (Color, Color) = switch logo {
        case .claude: (Color(red: 0.890, green: 0.545, blue: 0.424), Color(red: 0.776, green: 0.384, blue: 0.259))
        case .pi: (Color(red: 0.200, green: 0.212, blue: 0.333), Color(red: 0.086, green: 0.098, blue: 0.165))
        case nil: (accent.mixed(with: .white, 0.16).color, accent.mixed(with: .black, 0.14).color)
        }
        return LinearGradient(colors: [top, bottom], startPoint: .top, endPoint: .bottom)
    }
}

nonisolated extension AgentBrand.Logo {
    var glyph: String {
        switch self {
        case .claude: "AgentClaude"
        case .pi: "AgentPi"
        }
    }

    /// Claude's spark is round and thin, Pi's blocks are square and heavy, so the spark takes more
    /// of the tile for the two to weigh the same.
    var glyphShare: CGFloat {
        switch self {
        case .claude: 0.66
        case .pi: 0.46
        }
    }
}

/// A colour as components, so an accent from the wire can be lightened, darkened and weighed.
nonisolated struct RGB: Hashable, Sendable {
    static let white = RGB(red: 1, green: 1, blue: 1)
    static let black = RGB(red: 0, green: 0, blue: 0)
    static let slate = RGB(red: 0.373, green: 0.420, blue: 0.494)

    let red: Double
    let green: Double
    let blue: Double

    init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    init?(hex: String) {
        guard hex.wholeMatch(of: /#[0-9a-fA-F]{6}/) != nil, let value = UInt32(hex.dropFirst(), radix: 16) else {
            return nil
        }
        self.init(
            red: Double(value >> 16 & 0xFF) / 255, green: Double(value >> 8 & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255)
    }

    /// Relative luminance, 0 for black to 1 for white.
    var luminance: Double {
        func linear(_ channel: Double) -> Double {
            channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
    }

    /// Whether black text has the higher WCAG contrast ratio on this colour than white.
    var prefersDarkInk: Bool {
        (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05)
    }

    func mixed(with other: RGB, _ amount: Double) -> RGB {
        RGB(
            red: red + (other.red - red) * amount, green: green + (other.green - green) * amount,
            blue: blue + (other.blue - blue) * amount)
    }

    var color: Color { Color(red: red, green: green, blue: blue) }
}

/// An agent's mark in a continuous-corner tile of `side` points; VoiceOver reads its name.
struct AgentLogo: View {
    let brand: AgentBrand
    let side: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: side * 0.28, style: .continuous)
        figure
            .frame(width: side, height: side)
            .background {
                ZStack {
                    shape.fill(brand.fill)
                    if brand.logo == nil {
                        shape.fill(LinearGradient(
                            colors: [.white.opacity(0.26), .white.opacity(0)], startPoint: .top, endPoint: .center))
                    }
                }
            }
            .overlay { shape.strokeBorder(.white.opacity(0.14), lineWidth: max(0.5, side / 80)) }
            .accessibilityElement()
            .accessibilityLabel(brand.name)
    }

    @ViewBuilder private var figure: some View {
        if let logo = brand.logo {
            Image(logo.glyph)
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .foregroundStyle(.white)
                .frame(width: side * logo.glyphShare, height: side * logo.glyphShare)
        } else {
            AgentInitials(brand: brand, size: side * (brand.initials.count > 1 ? 0.38 : 0.46))
                .foregroundStyle(brand.tileInk)
                .padding(side * 0.1)
        }
    }
}

/// The mark alone in its own colour, for the Dynamic Island's black.
struct AgentGlyph: View {
    let brand: AgentBrand
    let side: CGFloat

    var body: some View {
        Group {
            if let logo = brand.logo {
                Image(logo.glyph)
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(width: side * (logo.glyphShare + 0.2), height: side * (logo.glyphShare + 0.2))
            } else {
                AgentInitials(brand: brand, size: side * (brand.initials.count > 1 ? 0.5 : 0.62))
            }
        }
        .foregroundStyle(brand.ink)
        .frame(width: side, height: side)
        .accessibilityLabel(brand.name)
    }
}

private struct AgentInitials: View {
    let brand: AgentBrand
    let size: CGFloat

    var body: some View {
        Text(verbatim: brand.initials)
            .font(.system(size: size, weight: .semibold, design: .rounded))
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}
