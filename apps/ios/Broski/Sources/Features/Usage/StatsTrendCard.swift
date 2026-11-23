import BroskiCore
import SwiftUI

/// The period at a glance: what it came to, how that compares with the period before, and the chart
/// beneath it. A finger on the chart reads one bar into the figure above it.
struct StatsTrendCard: View {
    let summary: StatsSummary
    @Binding var metric: StatsMetric
    let range: StatsRange
    @State private var touched: Date?

    private var buckets: StatsBuckets { StatsBuckets(series: summary.series, resolution: summary.resolution) }

    private var picked: StatsBuckets.Bucket? { touched.flatMap { buckets.bucket(at: $0) } }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .center) {
                Text(caption)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .contentTransition(.opacity)
                Spacer(minLength: Spacing.s)
                Picker("Show", selection: $metric) {
                    ForEach(StatsMetric.allCases) { Text($0.shortName).tag($0) }
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                .fixedSize()
            }
            Text(figure)
                .font(.system(size: 40, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.opacity)
            StatsTrendChart(buckets: buckets, metric: metric, touched: $touched, picked: picked)
                .padding(.top, Spacing.l)
        }
        .padding(Spacing.l + Spacing.xxs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
        .animation(.snappy(duration: 0.2), value: picked?.start)
        .sensoryFeedback(.selection, trigger: picked?.start) { _, now in now != nil }
    }

    private var caption: String {
        if let picked { return pickedDate(picked.start) }
        let what = metric == .cost ? "Spent" : "Tokens"
        guard summary.harnesses.count == 1, let only = summary.harnesses.first else { return what }
        return "\(only.displayName) · \(what)"
    }

    private var figure: String {
        let value = picked.map { $0.value(metric) } ?? (metric == .cost ? summary.totals.cost.total : Double(summary.totals.tokens.total))
        return metric == .cost ? StatsFormat.usdFigure(value) : StatsFormat.tokens(Int64(value))
    }

    private var detail: String {
        if let picked {
            let turns = "\(picked.turns.formatted()) \(picked.turns == 1 ? "turn" : "turns")"
            guard picked.slices.count > 1 else { return turns }
            let top = picked.slices.max { value($0) < value($1) }
            return [turns, top.map { "most by \($0.harness.displayName)" }].compactMap(\.self).joined(separator: " · ")
        }
        let sessions = "\(summary.totals.sessions.formatted()) \(summary.totals.sessions == 1 ? "session" : "sessions")"
        guard let previous = summary.previousTotals, let period = range.previousPeriod else { return sessions }
        let (now, before) = metric == .cost
            ? (summary.totals.cost.total, previous.cost.total)
            : (Double(summary.totals.tokens.total), Double(previous.tokens.total))
        let change = StatsFormat.delta(current: now, previous: before).map { $0 == "0%" ? "Same as \(period)" : "\($0) vs \(period)" }
        return [change, sessions].compactMap(\.self).joined(separator: " · ")
    }

    private func value(_ slice: StatsBuckets.Slice) -> Double {
        metric == .cost ? slice.costUsd : Double(slice.tokens)
    }

    private func pickedDate(_ date: Date) -> String {
        switch buckets.unit {
        case .hour: date.formatted(.dateTime.weekday(.abbreviated).hour())
        case .day: date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
        case .week: "Week of " + date.formatted(.dateTime.month(.abbreviated).day())
        }
    }
}
