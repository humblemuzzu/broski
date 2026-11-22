import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// Work the agent left running in the background: a glass pill above the composer saying what runs,
/// which opens in place to each task, its command and how long it has run. The whole header of the
/// open card folds it again, and so does a swipe down. Each task's end shows in the transcript as an
/// activity.
struct BackgroundTasksCard: View {
    let tasks: [BroskiCore.BackgroundTask]
    @State private var open = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if open {
                card
            } else {
                HStack {
                    pill
                    Spacer(minLength: 0)
                }
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.14) : .spring(duration: 0.28, bounce: 0.08), value: open)
        .haptic(.toggled(expanded: true), trigger: open) { !$0 && $1 }
        .haptic(.toggled(expanded: false), trigger: open) { $0 && !$1 }
    }

    private var summary: String {
        tasks.count == 1 ? agentLine(tasks[0].title) : "\(tasks.count) tasks in the background"
    }

    private var pill: some View {
        Button { open = true } label: {
            HStack(spacing: Spacing.s) {
                Orb(.working, side: 16, relativeTo: .footnote)
                Text(summary)
                    .font(.footnote.weight(.medium))
                    .lineLimit(1)
                Image(systemName: "chevron.up")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.leading, Spacing.m - 2)
            .padding(.trailing, Spacing.m)
            .frame(minHeight: 34)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityLabel(tasks.count == 1 ? "Running in the background: \(summary)" : summary)
        .accessibilityHint("Shows what runs")
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Button { open = false } label: {
                HStack(spacing: Spacing.s) {
                    Orb(.working, side: 16, relativeTo: .footnote)
                    Text("Running in the background")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: Spacing.s)
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.tertiary)
                }
                .frame(minHeight: 32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hide what runs in the background")
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    ForEach(tasks, id: \.id) { BackgroundTaskRow(task: $0) }
                }
                .padding(.bottom, Spacing.xs)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollIndicators(.hidden)
            .frame(maxHeight: 220)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Spacing.m + 2)
        .padding(.vertical, Spacing.s)
        .panelCard()
        .gesture(
            DragGesture(minimumDistance: 12).onEnded { drag in
                if drag.translation.height > 24 { open = false }
            })
    }
}

private struct BackgroundTaskRow: View {
    let task: BroskiCore.BackgroundTask
    @ScaledMetric(relativeTo: .footnote) private var iconWidth: CGFloat = 16

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Image(systemName: task.kind == .agent ? "person.2" : "terminal")
                .font(.caption)
                .frame(width: iconWidth)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(agentLine(task.title)).font(.footnote).lineLimit(1)
                if let command = task.command, !command.isEmpty, command != task.title {
                    Text(command).font(.codeSmall).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: Spacing.s)
            if let startedAt = task.startedAt {
                Text(Date(unixMilliseconds: startedAt), style: .timer)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
