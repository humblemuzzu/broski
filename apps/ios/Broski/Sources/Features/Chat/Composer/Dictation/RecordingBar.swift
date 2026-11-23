import SwiftUI
import UIKit

/// What takes the field's place while dictating, on the field's one line: "Listening…" (or, with the
/// finger down, how to cancel) and the time, while the composer's voice glow follows the voice; then
/// "Transcribing…", or why it failed with what to do.
struct RecordingBar: View {
    let dictation: Dictation
    let phase: Dictation.Phase
    let openVoiceSettings: () -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch phase {
        case .recording(let held, let cancelling):
            HStack(spacing: Spacing.s) {
                Text(line(held: held, cancelling: cancelling))
                    .font(.body)
                    .foregroundStyle(cancelling ? AnyShapeStyle(Palette.failed) : AnyShapeStyle(.secondary))
                    .lineLimit(1)
                    .contentTransition(.opacity)
                Spacer(minLength: 0)
                Elapsed(since: dictation.startedAt ?? .now)
            }
            .frame(minHeight: 26)
            .animation(.easeOut(duration: 0.15), value: cancelling)
            .accessibilityElement(children: .combine)
        case .transcribing(let onDevice):
            HStack(spacing: Spacing.s) {
                Text(onDevice ? "Transcribing on this iPhone…" : "Transcribing…")
                    .font(.body)
                    .shimmer(true)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 26)
        case .failed(let problem):
            Failure(problem: problem, retry: dictation.retry, discard: dictation.discard, openVoiceSettings: openVoiceSettings) {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
        case .idle:
            EmptyView()
        }
    }

    private func line(held: Bool, cancelling: Bool) -> String {
        if cancelling { return "Release to cancel" }
        return held ? "Slide left to cancel" : "Listening…"
    }
}

private struct Elapsed: View {
    let since: Date

    var body: some View {
        TimelineView(.periodic(from: since, by: 0.5)) { context in
            Text(Duration.seconds(max(0, context.date.timeIntervalSince(since))).formatted(.time(pattern: .minuteSecond)))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .accessibilityLabel("Recording")
    }
}

private struct Failure: View {
    let problem: DictationProblem
    let retry: () -> Void
    let discard: () -> Void
    let openVoiceSettings: () -> Void
    let openSystemSettings: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Label {
                Text(problem.message).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Palette.caution)
            }
            if let detail = problem.detail, !detail.isEmpty {
                Text(detail)
                    .font(.codeSmall)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .textSelection(.enabled)
            }
            HStack(spacing: Spacing.m) {
                switch problem.fix {
                case .retry: Button("Try Again", action: retry).prominentStyle()
                case .voiceSettings: Button("Voice Settings", action: openVoiceSettings).prominentStyle()
                case .systemSettings: Button("Open Settings", action: openSystemSettings).prominentStyle()
                case .none: EmptyView()
                }
                Button(problem.fix == .none ? "OK" : "Discard", action: discard).buttonStyle(.glass)
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(.vertical, Spacing.xs)
    }
}
