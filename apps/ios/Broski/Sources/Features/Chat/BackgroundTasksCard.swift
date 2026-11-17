import BroskiCore
import SwiftUI

/// Work the agent left running in the background: a glass pill above the composer saying what runs,
/// which opens in place to each task, its command and how long it has run. Each task's end shows in
/// the transcript as an activity.
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
        .animation(reduceMotion ? .easeOut(duration: 0.14) : .easeOut(duration: 0.22), value: open)
        .haptic(.toggled(expanded: true), trigger: open) { !$0 && $1 }
        .haptic(.toggled(expanded: false), trigger: open) { $0 && !$1 }
    }

    private var summary: String {
        tasks.count == 1 ? tasks[0].title : "\(tasks.count) tasks in the background"
    }

    private var pill: some View {
        Button { open = true } label: {
            HStack(spacing: Spacing.s) {
                LiveIndicator()
                Text(summary)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Image(systemName: "chevron.up")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, Spacing.m)
            .frame(minHeight: 36)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .accessibilityLabel(tasks.count == 1 ? "Running in the background: \(summary)" : summary)
        .accessibilityHint("Shows what runs")
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Text("IN THE BACKGROUND")
                    .font(.caption2.weight(.bold))
                    .tracking(1.1)
                    .foregroundStyle(.secondary)
                Spacer()
                Button { open = false } label: {
                    Image(systemName: "chevron.down").font(.footnote.weight(.semibold)).frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Hide")
            }
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    ForEach(tasks, id: \.id) { BackgroundTaskRow(task: $0) }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 220)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.s + 2)
        .background(.regularMaterial, in: .rect(cornerRadius: 16, style: .continuous))
    }
}

private struct BackgroundTaskRow: View {
    let task: BroskiCore.BackgroundTask
    @ScaledMetric(relativeTo: .footnote) private var iconWidth: CGFloat = 18

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
            Image(systemName: task.kind == .agent ? "person.2" : "terminal")
                .font(.footnote)
                .frame(width: iconWidth)
                .foregroundStyle(Palette.working)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(agentLine(task.title)).font(.footnote).lineLimit(2)
                if let command = task.command, !command.isEmpty, command != task.title {
                    Text(command).font(.codeSmall).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: Spacing.s)
            if let startedAt = task.startedAt {
                Text(Date(unixMilliseconds: startedAt), style: .timer)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
