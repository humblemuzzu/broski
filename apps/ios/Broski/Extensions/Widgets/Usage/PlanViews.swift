import SwiftUI
import WidgetKit

/// The plan's mark and name, its tier when there is room, and a quiet clock when the reading is
/// old or the last read failed.
struct PlanHeader: View {
    let report: PlanReport
    let now: Date
    var showsTier = false

    var body: some View {
        HStack(spacing: 6) {
            PlanGlyph(plan: report.plan, name: report.name, size: 14)
            Text(report.name)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            if showsTier, let tier = report.tier {
                Text(tier)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if report.problem != nil || report.isStale(at: now) {
                Image(systemName: "clock")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.tertiary)
                    .accessibilityLabel(report.problem ?? "This reading is old")
            }
        }
    }
}

/// One limit as a column: what it covers, what is left, its bar, when it resets.
struct LimitColumn: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date
    var figure: CGFloat = 30

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(window.label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            LeftFigure(window: window, now: now, size: figure)
            UsageBar(plan: report.plan, window: window, now: now, height: 7)
                .padding(.vertical, 2)
            Text(window.resetWords(at: now))
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "83% left": the figure a glance reads.
struct LeftFigure: View {
    let window: LimitWindow
    let now: Date
    var size: CGFloat = 30

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(window.leftPercent(at: now))
                .font(.system(size: size, weight: .semibold, design: .rounded))
                .monospacedDigit()
            Text("left")
                .font(.system(size: max(11, size * 0.4), weight: .medium))
                .foregroundStyle(.secondary)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
}

/// Small: the plan, then its fullest limit.
struct PlanSmall: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlanHeader(report: report, now: now)
            Spacer(minLength: 6)
            LimitColumn(report: report, window: window, now: now, figure: 32)
        }
        .padding(16)
    }
}

/// Medium: the plan, then its first two limits side by side.
struct PlanMedium: View {
    let report: PlanReport
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlanHeader(report: report, now: now, showsTier: true)
            Spacer(minLength: 8)
            HStack(alignment: .bottom, spacing: 20) {
                ForEach(report.orderedWindows.prefix(2)) { window in
                    LimitColumn(report: report, window: window, now: now)
                }
            }
        }
        .padding(16)
    }
}

/// Lock Screen, round: what is left around the plan's mark.
struct PlanCircular: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date

    var body: some View {
        Gauge(value: window.left(at: now)) {
            PlanGlyph(plan: report.plan, name: report.name, size: 12)
        } currentValueLabel: {
            VStack(spacing: 0) {
                PlanGlyph(plan: report.plan, name: report.name, size: 11)
                Text("\(Int((window.left(at: now) * 100).rounded()))")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            }
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
    }
}

/// Lock Screen, wide: the plan and what is left, the bar, what the limit covers.
struct PlanRectangular: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 4) {
                PlanGlyph(plan: report.plan, name: report.name, size: 11)
                Text(report.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                Spacer(minLength: 2)
                Text("\(window.leftPercent(at: now)) left")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
            }
            UsageBar(plan: report.plan, window: window, now: now, height: 6)
            Text(window.label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

/// Lock Screen, one line above the clock.
struct PlanInline: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date

    var body: some View {
        Label {
            Text("\(report.name) \(window.leftPercent(at: now)) left")
        } icon: {
            Image(systemName: "gauge.with.needle")
        }
    }
}
