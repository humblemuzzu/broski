import SwiftUI

/// A short status in a tinted capsule ("MacBook offline", "Reconnecting…"). Content, not a
/// control, so it uses a fill rather than glass; the symbol carries the meaning beside the color.
struct StatusChip: View {
    enum Tone {
        case neutral
        case progress
        case attention
        case critical

        var tint: Color {
            switch self {
            case .neutral: .secondary
            case .progress: Palette.working
            case .attention: Palette.caution
            case .critical: Palette.failed
            }
        }

        var symbol: String {
            switch self {
            case .neutral: "circle"
            case .progress: "arrow.triangle.2.circlepath"
            case .attention: "exclamationmark.triangle.fill"
            case .critical: "xmark.octagon.fill"
            }
        }
    }

    let text: String
    let tone: Tone

    var body: some View {
        Label {
            Text(text)
        } icon: {
            Image(systemName: tone.symbol)
                .symbolEffect(.rotate, options: .repeating, isActive: tone == .progress)
        }
        .font(.footnote.weight(.medium))
        .foregroundStyle(tone.tint)
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.xs + Spacing.xxs)
        .background(tone.tint.opacity(0.14), in: .capsule)
    }
}

extension MachineSummary.Health {
    var tone: StatusChip.Tone {
        switch self {
        case .ready: .neutral
        case .settling: .progress
        case .attention: .attention
        case .revoked: .critical
        }
    }
}
