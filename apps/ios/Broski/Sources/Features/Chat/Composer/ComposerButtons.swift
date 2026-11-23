import SwiftUI

/// The composer's measures. Its row is 36 pt controls 8 pt in from the edge, so the collapsed
/// composer is 52 pt high and its 26 pt corners make it a capsule.
nonisolated enum ComposerMetrics {
    static let control: CGFloat = 36
    static let inset: CGFloat = 8
    static let radius: CGFloat = 26
    static let glyph = Font.system(size: 17, weight: .regular)
}

extension Color {
    /// The round controls' and the model pill's fill: a soft step up from the glass under it.
    static let composerFill = Color(uiColor: .tertiarySystemFill)
}

extension View {
    /// A round control of the composer's row.
    func composerCircle(_ fill: Color = .composerFill) -> some View {
        frame(width: ComposerMetrics.control, height: ComposerMetrics.control)
            .background(fill, in: .circle)
            .contentShape(.circle)
    }
}

/// ✕ in place of `+` while dictating: throws the recording away.
struct CancelDictation: View {
    let cancel: () -> Void

    var body: some View {
        Button(action: cancel) {
            Image(systemName: "xmark")
                .font(ComposerMetrics.glyph)
                .foregroundStyle(.primary)
                .composerCircle()
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Cancel dictation")
    }
}

/// The one button that acts: an ink circle while it can send or stop, a soft one while it cannot.
/// While a run is live and the backend takes both, a long press offers the other way to send.
struct SendButton: View {
    let action: SendAction
    let alternative: SendAction?
    let canSend: Bool
    let perform: (SendAction) -> Void
    @Environment(\.isEnabled) private var isEnabled

    private var isActive: Bool { isEnabled && (action == .stop || (action != .wait && canSend)) }

    var body: some View {
        Group {
            if let alternative {
                Menu {
                    choice(action)
                    choice(alternative)
                } label: {
                    face
                } primaryAction: {
                    perform(action)
                }
            } else {
                Button { perform(action) } label: { face }
            }
        }
        .buttonStyle(.plain)
        .disabled(!isActive)
        .accessibilityLabel(action.title)
        .accessibilityHint(alternative.map { "Touch and hold for \($0.title)" } ?? "")
    }

    private var face: some View {
        Image(systemName: action.symbol)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(isActive ? AnyShapeStyle(Palette.onAccent) : AnyShapeStyle(.tertiary))
            .contentTransition(.symbolEffect(.replace))
            .composerCircle(isActive ? Palette.accent : .composerFill)
            .animation(.snappy(duration: 0.2), value: action)
            .animation(.snappy(duration: 0.2), value: isActive)
    }

    private func choice(_ way: SendAction) -> some View {
        Button { perform(way) } label: {
            Label {
                Text(way.title)
                Text(way.explanation)
            } icon: {
                Image(systemName: way.symbol)
            }
        }
    }
}
