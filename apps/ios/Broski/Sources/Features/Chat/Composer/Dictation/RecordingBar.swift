import SwiftUI
import UIKit

/// What takes the field's place while dictating: the live waveform and time, then "Transcribing…",
/// or why it failed with what to do.
struct RecordingBar: View {
    let dictation: Dictation
    let phase: Dictation.Phase
    let openVoiceSettings: () -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch phase {
        case .recording(let held, let cancelling):
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(spacing: Spacing.s) {
                    RecordingDot()
                    Elapsed(since: dictation.startedAt ?? .now)
                    Waveform(levels: dictation.levels, count: Dictation.levelCount, dimmed: cancelling)
                        .frame(height: 26)
                }
                Text(hint(held: held, cancelling: cancelling))
                    .font(.caption)
                    .foregroundStyle(cancelling ? Palette.failed : .secondary)
                    .contentTransition(.opacity)
            }
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

    private func hint(held: Bool, cancelling: Bool) -> String {
        if cancelling { return "Release to cancel" }
        return held ? "Release to insert · slide left to cancel" : "Tap ✓ to insert, ✕ to cancel"
    }
}

private struct RecordingDot: View {
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(Palette.failed)
            .frame(width: 9, height: 9)
            .opacity(dim ? 0.35 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.7).repeatForever()) { dim = true }
            }
            .accessibilityHidden(true)
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

/// The last few seconds' loudness as bars, newest at the right.
private struct Waveform: View {
    let levels: [Float]
    let count: Int
    let dimmed: Bool

    var body: some View {
        Canvas { context, size in
            let gap: CGFloat = 2
            let width = max(1, (size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            let padded = Array(repeating: Float(0), count: max(0, count - levels.count)) + levels.suffix(count)
            for (index, level) in padded.enumerated() {
                let height = max(3, CGFloat(level) * size.height)
                let rect = CGRect(
                    x: CGFloat(index) * (width + gap), y: (size.height - height) / 2, width: width, height: height)
                context.fill(Path(roundedRect: rect, cornerRadius: width / 2), with: .color(dimmed ? .secondary : Palette.accent))
            }
        }
        .accessibilityHidden(true)
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
                case .retry: Button("Try Again", action: retry).buttonStyle(.glassProminent)
                case .voiceSettings: Button("Voice Settings", action: openVoiceSettings).buttonStyle(.glassProminent)
                case .systemSettings: Button("Open Settings", action: openSystemSettings).buttonStyle(.glassProminent)
                case .none: EmptyView()
                }
                Button(problem.fix == .none ? "OK" : "Discard", action: discard).buttonStyle(.glass)
            }
            .font(.subheadline.weight(.semibold))
        }
        .padding(.vertical, Spacing.xs)
    }
}
