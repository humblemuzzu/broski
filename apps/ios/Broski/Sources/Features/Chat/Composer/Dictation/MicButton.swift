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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var isEnabled

    /// How far left the finger slides before letting go cancels.
    static let cancelDistance: CGFloat = 70

    var body: some View {
        face
            .frame(width: ComposerMetrics.control, height: ComposerMetrics.control)
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
            Image(systemName: cancelling ? "xmark" : "mic.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(cancelling ? AnyShapeStyle(Color.white) : AnyShapeStyle(Palette.onAccent))
                .contentTransition(.symbolEffect(.replace))
                .composerCircle(cancelling ? Palette.failed : Palette.accent)
                .scaleEffect(reduceMotion ? 1 : 1.12)
        case .recording(held: false, _):
            Image(systemName: "checkmark")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Palette.onAccent)
                .composerCircle(Palette.accent)
        case .transcribing:
            Orb(.listening, side: 22)
                .composerCircle()
        case .idle, .failed:
            Image(systemName: "mic")
                .font(ComposerMetrics.glyph)
                .foregroundStyle(.primary)
                .composerCircle()
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
