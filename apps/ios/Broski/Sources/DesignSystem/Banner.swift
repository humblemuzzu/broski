import SwiftUI

/// An inline notice in content: what happened, what to do, and at most one action. Errors carry a
/// plain sentence; a code, if any, goes in `detail` in a quieter type.
struct Banner<Action: View>: View {
    enum Style {
        case info
        case warning
        case error

        var tint: Color {
            switch self {
            case .info: Palette.accent
            case .warning: Palette.caution
            case .error: Palette.failed
            }
        }

        var symbol: String {
            switch self {
            case .info: "info.circle.fill"
            case .warning: "exclamationmark.triangle.fill"
            case .error: "xmark.octagon.fill"
            }
        }
    }

    let style: Style
    let message: String
    var detail: String?
    @ViewBuilder var action: () -> Action

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
            Image(systemName: style.symbol)
                .foregroundStyle(style.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.s) {
                Text(message)
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail {
                    Text(detail)
                        .font(.codeSmall)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                action()
                    .font(.subheadline.weight(.semibold))
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.l)
        .background(style.tint.opacity(0.1), in: .rect(cornerRadius: Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

extension Banner where Action == EmptyView {
    init(style: Style, message: String, detail: String? = nil) {
        self.init(style: style, message: message, detail: detail) { EmptyView() }
    }
}

extension View {
    /// Content of a machine that is not reachable stays listed, dimmed.
    func dimmed(_ isDimmed: Bool) -> some View {
        opacity(isDimmed ? 0.5 : 1)
    }
}
