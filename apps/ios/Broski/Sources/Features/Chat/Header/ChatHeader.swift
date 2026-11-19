import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// The chat's title in the bar: the session's title (tap to rename), and under it `agent · folder ·
/// machine`, or the machine's state in words while it is not ready; while a run is live, a working
/// orb and its elapsed time in tabular figures.
struct ChatTitle: View {
    let title: String
    let subtitle: String
    let machineProblem: String?
    let runStartedAt: Int64?
    let canRename: Bool
    let rename: () -> Void

    var body: some View {
        Button(action: rename) {
            VStack(spacing: 0) {
                Text(title)
                    .font(.headline)
                    .lineLimit(1)
                HStack(spacing: Spacing.xs) {
                    if let runStartedAt, machineProblem == nil {
                        Orb(.working, side: 14, relativeTo: .caption)
                        ElapsedTime(since: runStartedAt).foregroundStyle(Palette.working)
                        Text("·")
                    }
                    Text(machineProblem ?? subtitle)
                        .foregroundStyle(machineProblem == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(Palette.caution))
                        .lineLimit(1)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: 260)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(!canRename)
        .accessibilityElement(children: .combine)
        .accessibilityHint(canRename ? "Renames the session" : "")
        .accessibilityIdentifier("chat.title")
    }
}

/// "12s", "3m", counting each second.
struct ElapsedTime: View {
    let since: Int64

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(WorkSummary.format(max(0, context.date.timeIntervalSince(Date(unixMilliseconds: since)))))
                .monospacedDigit()
                .contentTransition(.numericText())
        }
    }
}

/// The overflow's icon with how full the context window is drawn around it, when known.
struct ContextRing: View {
    let fraction: Double?

    var body: some View {
        Image(systemName: "ellipsis")
            .frame(width: 28, height: 28)
            .overlay {
                if let fraction {
                    Circle()
                        .stroke(.quaternary, lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: min(1, max(0.02, fraction)))
                        .stroke(fraction > 0.85 ? Palette.caution : Palette.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
            }
            .accessibilityValue(fraction.map { "Context \(Int(($0 * 100).rounded())) percent used" } ?? "")
    }
}

extension Usage {
    /// How much of the context window the conversation fills, when both are reported.
    func contextFraction(window fallback: Int64?) -> Double? {
        guard let tokens = contextTokens, let window = contextWindow ?? fallback, window > 0 else { return nil }
        return Double(tokens) / Double(window)
    }
}
