import SwiftUI
import ThinkingOrbsKit

/// The composer's mic. Touch and hold to talk, let go to insert, slide left to cancel; a tap starts
/// a recording that goes on by itself, and the button then turns into ✓, which inserts it. The
/// recording starts on touch down, so the first word is never lost to a long-press delay.
struct MicButton: View {
    let phase: Dictation.Phase
    let press: (UITouch?) -> Void
    let slide: (_ cancelling: Bool) -> Void
    let release: (_ held: TimeInterval) -> Void
    @ScaledMetric(relativeTo: .body) private var scaledSide: CGFloat = 36
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    /// How far left the finger slides before letting go cancels.
    static let cancelDistance: CGFloat = 70

    private var side: CGFloat { min(scaledSide, 52) }

    var body: some View {
        face
            .frame(width: side, height: side)
            .contentShape(.circle)
            .overlay {
                MicTouchArea(enabled: isEnabled, press: press, slide: { slide($0 > Self.cancelDistance) }, release: release)
            }
            .accessibilityElement()
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(label)
            .accessibilityHint(hint)
            .accessibilityAction {
                press(nil)
                release(0)
            }
            .animation(reduceMotion ? nil : .spring(duration: 0.25, bounce: 0.2), value: phase)
    }

    @ViewBuilder
    private var face: some View {
        switch phase {
        case .recording(held: true, let cancelling):
            Circle()
                .fill(cancelling ? Color.secondary : Palette.failed)
                .overlay {
                    Image(systemName: cancelling ? "xmark" : "mic.fill")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.white)
                        .contentTransition(.symbolEffect(.replace))
                }
                .scaleEffect(reduceMotion ? 1 : 1.18)
        case .recording(held: false, _):
            Circle()
                .fill(Palette.accent)
                .overlay {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.bold))
                        .foregroundStyle(.white)
                }
        case .transcribing:
            Orb(.listening, side: 24)
        case .idle, .failed:
            Image(systemName: "mic")
                .font(.body.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }

    private var label: String {
        switch phase {
        case .recording(held: false, _): "Insert dictation"
        case .recording: "Recording"
        case .transcribing: "Transcribing"
        case .idle, .failed: "Dictate"
        }
    }

    private var hint: String {
        switch phase {
        case .recording(held: false, _): "Stops recording and types what you said."
        case .transcribing: ""
        default: "Starts recording. Touch and hold to talk, or tap to start and tap again to finish."
        }
    }
}
