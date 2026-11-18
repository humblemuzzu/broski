import SwiftUI
import WidgetKit

/// The plan's mark and name in its colour, and on the right a quiet word, or a warning when the
/// reading is old or the last read failed.
struct PlanTitle: View {
    let report: PlanReport
    let now: Date
    var trailing: String?

    var body: some View {
        HStack(spacing: 6) {
            PlanGlyph(plan: report.plan, size: 14)
            Text(report.plan.name)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(report.plan.bright)
                .lineLimit(1)
            Spacer(minLength: 4)
            if report.problem != nil || report.isStale(at: now) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.orange)
                    .accessibilityLabel(report.problem ?? "This reading is old")
            } else if let trailing {
                Eyebrow(trailing, style: .tertiary)
            }
        }
    }
}

/// What a window covers, in a few words: "Weekly", "Weekly · Fable", "5-hour · Gemini".
extension LimitWindow {
    var label: String {
        shortScope.map { "\(span.title) · \($0)" } ?? span.title
    }
}

/// Small: the plan, its figure, the meter, and when it resets.
struct PlanSmall: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlanTitle(report: report, now: now)
            Spacer(minLength: 4)
            HeroPercent(used: window.used(at: now), size: 44, color: report.plan.bright)
            Text(window.label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Spacer(minLength: 8)
            TickMeter(plan: report.plan, window: window, now: now, height: 22)
            Spacer(minLength: 8)
            if let resetsAt = window.resetsAt, resetsAt > now {
                HStack(spacing: 4) {
                    Image(systemName: "arrow.counterclockwise")
                    TimeLeft(resetsAt: resetsAt, now: now)
                }
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
        .padding(16)
    }
}

/// Medium: the plan and its figure on one line, the meter on its scale, then the window's journey.
struct PlanMedium: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    PlanTitle(report: report, now: now)
                    Text(window.label)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                HeroPercent(used: window.used(at: now), size: 36, color: report.plan.bright)
            }
            Spacer(minLength: 6)
            TickMeter(plan: report.plan, window: window, now: now, height: 24, showsScale: true)
            Spacer(minLength: 10)
            TimeTrack(plan: report.plan, window: window, now: now)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

/// Lock Screen, round: the window's share around the plan's mark.
struct PlanCircular: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date

    var body: some View {
        Gauge(value: window.used(at: now)) {
            PlanGlyph(plan: report.plan, size: 12)
        } currentValueLabel: {
            VStack(spacing: 0) {
                PlanGlyph(plan: report.plan, size: 11)
                Text("\(Int((window.used(at: now) * 100).rounded()))")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .monospacedDigit()
            }
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .widgetAccentable()
    }
}

/// Lock Screen, wide: the plan and its figure over the meter.
struct PlanRectangular: View {
    let report: PlanReport
    let window: LimitWindow
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                PlanGlyph(plan: report.plan, size: 11)
                Text(report.plan.name).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                Spacer(minLength: 2)
                Text("\(Int((window.used(at: now) * 100).rounded()))%")
                    .font(.system(size: 17, weight: .bold))
                    .monospacedDigit()
            }
            TickMeter(plan: report.plan, window: window, now: now, height: 14)
            Text(window.label.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .tracking(0.5)
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
            Text("\(report.plan.name) \(Int((window.used(at: now) * 100).rounded()))% \(window.span.shortTitle.lowercased())")
        } icon: {
            Image(systemName: "gauge.with.needle")
        }
    }
}
