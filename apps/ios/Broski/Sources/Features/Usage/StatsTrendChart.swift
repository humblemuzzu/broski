import Charts
import SwiftUI

/// The period as one capsule per hour, day or week: a faint track the height of the busiest, filled
/// from the bottom in ink as the Limits bars fill, and a dotted line at the average. Under it, its first
/// and last moments at its edges and what the average comes to between them. A finger reads one bar;
/// the rest step back.
struct StatsTrendChart: View {
    let buckets: StatsBuckets
    let metric: StatsMetric
    @Binding var touched: Date?
    let picked: StatsBuckets.Bucket?

    /// A bar never draws thinner than a dot, nor wider than this, whatever the period.
    private static let widest: CGFloat = 14
    /// The share of its slot a bar takes; the rest is the gap.
    private static let fill: CGFloat = 0.56

    private var peak: Double { buckets.buckets.map { $0.value(metric) }.max() ?? 0 }

    private var average: Double {
        guard !buckets.buckets.isEmpty else { return 0 }
        return buckets.buckets.reduce(0) { $0 + $1.value(metric) } / Double(buckets.buckets.count)
    }

    var body: some View {
        VStack(spacing: Spacing.s) {
            GeometryReader { proxy in
                let slot = proxy.size.width / CGFloat(max(1, buckets.buckets.count))
                chart(barWidth: max(2, min(Self.widest, (slot * Self.fill).rounded())))
            }
            .frame(height: 168)
            edges
        }
    }

    private func chart(barWidth: CGFloat) -> some View {
        let top = peak > 0 ? peak : 1
        return Chart {
            ForEach(buckets.buckets) { bucket in
                let x = PlottableValue.value("Time", bucket.start, unit: buckets.unit.component)
                let dimmed = picked != nil && picked?.start != bucket.start
                BarMark(x: x, yStart: .value("Track", 0), yEnd: .value("Track", top), width: .fixed(barWidth))
                    .cornerRadius(barWidth / 2, style: .continuous)
                    .foregroundStyle(Color.primary.opacity(0.06))
                    .accessibilityHidden(true)
                let value = bucket.value(metric)
                if value > 0 {
                    BarMark(x: x, yStart: .value(metric.shortName, 0), yEnd: .value(metric.shortName, max(value, top * 0.015)), width: .fixed(barWidth))
                        .cornerRadius(barWidth / 2, style: .continuous)
                        .foregroundStyle(LinearGradient(
                            colors: [Color.primary.opacity(0.92), Color.primary.opacity(0.5)], startPoint: .top, endPoint: .bottom))
                        .opacity(dimmed ? 0.28 : 1)
                }
            }
            if average > 0 {
                RuleMark(y: .value("Average", average))
                    .lineStyle(Self.averageStroke)
                    .foregroundStyle(Color.primary.opacity(0.45))
                    .accessibilityLabel("Average \(StatsFormat.compact(average, metric: metric)) \(perBucket)")
            }
        }
        .chartYScale(domain: 0...top)
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartXSelection(value: $touched)
        .overlay {
            if peak == 0 {
                Text("Nothing ran in this period")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var perBucket: String {
        switch buckets.unit {
        case .hour: "an hour"
        case .day: "a day"
        case .week: "a week"
        }
    }

    private static let averageStroke = StrokeStyle(lineWidth: 1, lineCap: .round, dash: [0.5, 4])

    private var edges: some View {
        HStack(spacing: Spacing.s) {
            if let first = buckets.buckets.first { Text(label(first.start, isLast: false)) }
            Spacer(minLength: 0)
            if average > 0 {
                HStack(spacing: Spacing.xs + 2) {
                    Path { $0.addLines([.zero, CGPoint(x: 14, y: 0)]) }
                        .stroke(Color.primary.opacity(0.45), style: Self.averageStroke)
                        .frame(width: 14, height: 1)
                    Text("avg \(StatsFormat.compact(average, metric: metric)) \(perBucket)")
                        .monospacedDigit()
                }
            }
            Spacer(minLength: 0)
            if let last = buckets.buckets.last { Text(label(last.start, isLast: true)) }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .accessibilityHidden(true)
    }

    private func label(_ date: Date, isLast: Bool) -> String {
        let calendar = Calendar.current
        switch buckets.unit {
        case .hour:
            return isLast && calendar.isDate(date, equalTo: .now, toGranularity: .hour) ? "Now" : date.formatted(.dateTime.hour())
        case .day:
            return isLast && calendar.isDateInToday(date) ? "Today" : date.formatted(.dateTime.month(.abbreviated).day())
        case .week:
            return isLast && calendar.isDate(date, equalTo: .now, toGranularity: .weekOfYear) ? "This week" : date.formatted(.dateTime.month(.abbreviated).day())
        }
    }
}
