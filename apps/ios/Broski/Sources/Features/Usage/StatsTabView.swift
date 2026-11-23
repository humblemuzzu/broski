import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// Stats: what the agents on the paired Macs used over a period, as tokens or as what the same use
/// would cost at API prices. The period, then the trend with its figure, then the agents, what the
/// use went to and by which kind of token, and a line on where the prices come from.
struct StatsTabView: View {
    @Environment(AppModel.self) private var model

    private var stats: StatsModel { model.stats }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            Picker("Period", selection: range) {
                ForEach(StatsRange.ordered, id: \.self) { Text($0.shortName).tag($0) }
            }
            .pickerStyle(.segmented)
            if let summary = stats.summary {
                StatsTrendCard(summary: summary, metric: metric, range: summary.range)
                StatsAgentsCard(
                    summary: summary, metric: stats.metric, isNarrowed: stats.selectedHarness != nil,
                    toggle: { harness in Task { await stats.toggleHarness(harness, machines: model.machines) } },
                    widen: { Task { await stats.clearHarness(machines: model.machines) } })
                StatsTopCard(summary: summary, metric: stats.metric)
                StatsTypesCard(totals: summary.totals, metric: stats.metric)
                footnote(summary)
            } else if stats.isReading {
                VStack(spacing: Spacing.m) {
                    Orb(.working, side: 44)
                    Text("Reading your agents' history")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.xxxl)
            } else {
                ContentUnavailableView {
                    Label("No stats yet", systemImage: "chart.bar.xaxis")
                } description: {
                    Text(emptyNote)
                }
                .padding(.top, Spacing.xxl)
            }
        }
        .animation(.snappy(duration: 0.25), value: stats.metric)
    }

    private var range: Binding<StatsRange> {
        Binding { stats.range } set: { next in Task { await stats.selectRange(next, machines: model.machines) } }
    }

    private var metric: Binding<StatsMetric> {
        Binding { stats.metric } set: { stats.metric = $0 }
    }

    private var emptyNote: String {
        if !model.machines.contains(where: \.summary.isReady) {
            return "Your Mac reads your agents' history once it's connected."
        }
        return "Nothing ran in this period. Pull to read your agents' history again."
    }

    private func footnote(_ summary: StatsSummary) -> some View {
        let unpriced = summary.totals.unpricedTurns
        let lines = [
            summary.scanState == .fresh ? nil : "Still reading your agents' history.",
            StatsFormat.costNote(summary.totals.costSource),
            unpriced > 0 ? "\(unpriced.formatted()) \(unpriced == 1 ? "turn has" : "turns have") no price and count as nothing." : nil,
        ].compactMap(\.self)
        return Text(lines.joined(separator: " "))
            .font(.footnote)
            .foregroundStyle(.tertiary)
            .padding(.horizontal, Spacing.xs)
    }
}
