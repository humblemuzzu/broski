import Charts
import SwiftUI
import WidgetKit

/// A window as a chart across its own span, start to reset: the area of what was used, the dashed
/// diagonal of an even pace up to the limit, the limit itself, a dot where use stands, and where the
/// pace so far would take it by the reset (or the moment it would run out). A stretch before the Mac's
/// first reading is drawn dashed from the window's empty start, as an estimate.
struct BurnChart: View {
    enum Style {
        /// No axes, edge to edge: a widget's backdrop.
        case spark
        /// The span's days or hours along the bottom.
        case axes
    }

    let plan: UsagePlan
    let window: LimitWindow
    let now: Date
    var style: Style = .spark

    @Environment(\.widgetRenderingMode) private var renderingMode

    private struct Plot {
        let start: Date
        let end: Date
        let known: [UsagePoint]
        let estimate: [UsagePoint]
        let projection: [UsagePoint]
        var latest: UsagePoint { known.last ?? UsagePoint(at: start, usedPercent: 0) }
    }

    private var plot: Plot {
        guard let start = window.start, let end = window.resetsAt, end > now else {
            return Plot(
                start: now, end: now.addingTimeInterval(window.span.duration),
                known: [UsagePoint(at: now, usedPercent: 0)], estimate: [], projection: [])
        }
        let known = window.trace(at: now)
        let first = known.first ?? UsagePoint(at: now, usedPercent: window.usedPercent)
        let gap = first.at.timeIntervalSince(start) > window.span.duration / 60
        let estimate = gap ? [UsagePoint(at: start, usedPercent: 0), first] : []
        return Plot(start: start, end: end, known: known, estimate: estimate, projection: projection(from: known.last ?? first, start: start, end: end))
    }

    /// From the latest reading at the pace since the window began, to the reset or to the limit.
    private func projection(from latest: UsagePoint, start: Date, end: Date) -> [UsagePoint] {
        let elapsed = latest.at.timeIntervalSince(start)
        guard elapsed > window.span.duration * 0.05, latest.usedPercent >= 1, latest.usedPercent < 100 else { return [] }
        let rate = latest.usedPercent / elapsed
        let atEnd = latest.usedPercent + rate * end.timeIntervalSince(latest.at)
        if atEnd <= 100 { return [latest, UsagePoint(at: end, usedPercent: atEnd)] }
        let out = latest.at.addingTimeInterval((100 - latest.usedPercent) / rate)
        return [latest, UsagePoint(at: out, usedPercent: 100)]
    }

    var body: some View {
        let plot = plot
        let tint = window.severity(at: now).tint(for: plan)
        let fullColor = renderingMode == .fullColor
        Chart {
            RuleMark(y: .value("Limit", 100))
                .foregroundStyle(.primary.opacity(0.14))
                .lineStyle(StrokeStyle(lineWidth: 0.75))

            ForEach([plot.start, plot.end], id: \.self) { at in
                LineMark(
                    x: .value("Time", at), y: .value("Used", at == plot.start ? 0.0 : 100.0),
                    series: .value("Line", "pace"))
                    .foregroundStyle(.primary.opacity(0.22))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [2, 3]))
            }

            ForEach(Array((plot.estimate.dropLast() + plot.known).enumerated()), id: \.offset) { _, point in
                AreaMark(
                    x: .value("Time", point.at), yStart: .value("Base", 0.0), yEnd: .value("Used", point.usedPercent))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [tint.opacity(fullColor ? 0.42 : 0.5), tint.opacity(fullColor ? 0.04 : 0.1)],
                            startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
            }

            ForEach(Array(plot.estimate.enumerated()), id: \.offset) { _, point in
                LineMark(x: .value("Time", point.at), y: .value("Used", point.usedPercent), series: .value("Line", "estimate"))
                    .foregroundStyle(tint.opacity(0.55))
                    .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [1, 3]))
            }

            ForEach(Array(plot.known.enumerated()), id: \.offset) { _, point in
                LineMark(x: .value("Time", point.at), y: .value("Used", point.usedPercent), series: .value("Line", "used"))
                    .foregroundStyle(tint)
                    .lineStyle(StrokeStyle(lineWidth: style == .spark ? 2 : 2.25, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }

            ForEach(Array(plot.projection.enumerated()), id: \.offset) { _, point in
                LineMark(
                    x: .value("Time", point.at), y: .value("Used", point.usedPercent), series: .value("Line", "projection"))
                    .foregroundStyle(tint.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1.25, lineCap: .round, dash: [3, 3]))
            }

            if plot.projection.last?.usedPercent == 100, let out = plot.projection.last {
                PointMark(x: .value("Time", out.at), y: .value("Used", 100.0))
                    .symbol(.cross)
                    .symbolSize(style == .spark ? 30 : 44)
                    .foregroundStyle(LimitWindow.Severity.critical.tint(for: plan))
            }

            PointMark(x: .value("Time", plot.latest.at), y: .value("Used", plot.latest.usedPercent))
                .symbolSize(style == .spark ? 150 : 220)
                .foregroundStyle(tint.opacity(0.22))
            PointMark(x: .value("Time", plot.latest.at), y: .value("Used", plot.latest.usedPercent))
                .symbolSize(style == .spark ? 26 : 34)
                .foregroundStyle(tint)
        }
        .chartXScale(domain: plot.start...plot.end)
        .chartYScale(domain: 0...103)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartXAxis(style == .axes ? .visible : .hidden)
        .widgetAccentable()
        .accessibilityElement()
        .accessibilityLabel("\(window.title): \(Int((window.used(at: now) * 100).rounded())) percent used")
    }

    @AxisContentBuilder private var xAxis: some AxisContent {
        AxisMarks(values: .stride(by: window.span == .week ? .day : .hour)) { _ in
            AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                .foregroundStyle(.primary.opacity(0.08))
            AxisValueLabel(
                format: window.span == .week ? .dateTime.weekday(.narrow) : .dateTime.hour(.defaultDigits(amPM: .narrow)),
                anchor: .top)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(Color.secondary)
        }
    }
}
