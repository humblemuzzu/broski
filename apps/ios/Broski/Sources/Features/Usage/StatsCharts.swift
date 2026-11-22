import BroskiCore
import Charts
import SwiftUI

struct ShareSegment: Identifiable {
    let id: String
    let caption: String
    let value: Double
    let tint: Color
}

/// Stacked daily or hourly bar chart colored by coding agent.
struct StatsActivityChart: View {
    let series: [StatsSeriesPoint]
    let resolution: StatsResolution
    let metric: StatsMetric

    private struct BarItem: Identifiable {
        let id: String
        let slotIndex: Int
        let axisName: String
        let harness: StatsHarness
        let value: Double
    }

    private var items: [BarItem] {
        var result: [BarItem] = []
        for (index, point) in series.enumerated() {
            if point.byHarness.isEmpty {
                result.append(BarItem(id: "\(index)-empty", slotIndex: index, axisName: point.label, harness: .claude, value: 0))
            } else {
                for slice in point.byHarness {
                    let v = metric == .cost ? slice.costUsd : Double(slice.totalTokens)
                    result.append(BarItem(
                        id: "\(index)-\(slice.harness)",
                        slotIndex: index,
                        axisName: point.label,
                        harness: slice.harness,
                        value: v
                    ))
                }
            }
        }
        return result
    }

    private var heading: String {
        switch (resolution, metric) {
        case (.hour, .cost): "Hourly cost"
        case (.hour, .tokens): "Hourly tokens"
        case (.day, .cost): "Daily cost"
        case (.day, .tokens): "Daily tokens"
        }
    }

    private var hasData: Bool {
        series.contains { metric == .cost ? $0.costUsd > 0 : $0.totalTokens > 0 }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text(heading)
                .font(.subheadline.weight(.semibold))
            if hasData {
                Chart(items) { item in
                    BarMark(
                        x: .value("Slot", item.slotIndex),
                        y: .value("Value", item.value)
                    )
                    .foregroundStyle(item.harness.tint)
                    .cornerRadius(2)
                }
                .chartXAxis {
                    AxisMarks(values: xTickIndices) { value in
                        if let idx = value.as(Int.self), idx >= 0, idx < series.count {
                            let axisCaption = series[idx].label
                            AxisValueLabel {
                                Text(axisCaption)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                        AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                            .foregroundStyle(.quaternary)
                        if let num = value.as(Double.self) {
                            let formatted = metric == .cost ? StatsFormat.usd(num) : StatsFormat.tokens(Int64(num))
                            AxisValueLabel {
                                Text(formatted)
                                    .font(.caption2)
                                    .monospacedDigit()
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .frame(height: 156)
            } else {
                Text("No activity in this window.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 90, alignment: .center)
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
    }

    private var xTickIndices: [Int] {
        let count = series.count
        guard count > 0 else { return [] }
        if count <= 5 { return Array(0..<count) }
        return [0, count / 2, count - 1]
    }
}

/// Horizontal segmented bar with colored dot legend (used for Cost by type, Tokens by type, Cost by speed).
struct StatsShareBarCard: View {
    let heading: String
    let aside: String?
    let segments: [ShareSegment]
    let formatValue: (Double) -> String

    private var total: Double {
        segments.reduce(0) { $0 + max(0, $1.value) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(alignment: .firstTextBaseline) {
                Text(heading)
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: Spacing.s)
                if let aside {
                    Text(aside)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }

            GeometryReader { geo in
                let active = segments.filter { $0.value > 0 }
                let gapTotal = CGFloat(max(0, active.count - 1)) * 2
                let usable = max(0, geo.size.width - gapTotal)
                HStack(spacing: 2) {
                    ForEach(active) { seg in
                        let fraction = total > 0 ? seg.value / total : 0
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(seg.tint)
                            .frame(width: max(2, usable * fraction))
                    }
                }
            }
            .frame(height: 10)
            .clipShape(Capsule())

            VStack(spacing: Spacing.s) {
                ForEach(segments) { seg in
                    HStack(spacing: Spacing.s) {
                        Circle()
                            .fill(seg.tint)
                            .frame(width: 8, height: 8)
                        Text(seg.caption)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: Spacing.s)
                        Text(formatValue(seg.value))
                            .font(.footnote.weight(.medium))
                            .monospacedDigit()
                        Text(StatsFormat.percent(total > 0 ? seg.value / total : 0))
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .monospacedDigit()
                            .frame(width: 40, alignment: .trailing)
                    }
                }
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
    }
}
