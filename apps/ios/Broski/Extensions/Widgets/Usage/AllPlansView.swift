import SwiftUI
import WidgetKit

/// Every plan the Macs read. Medium: a meter each, with its figure, reset and pace. Large: a panel
/// each, with the window's journey and the plan's other windows.
struct AllPlansView: View {
    let entry: UsageEntry
    @Environment(\.widgetFamily) private var family

    private var plans: [PlanReport] {
        UsagePlan.allCases.compactMap { entry.report?.plan($0) }.filter { !$0.windows.isEmpty }
    }

    var body: some View {
        Group {
            if plans.isEmpty {
                NoReading(plan: .claude, report: nil, hasReport: entry.report != nil)
                    .padding(16)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                        if index > 0 { Hairline() }
                        Group {
                            if family == .systemLarge {
                                PlanPanel(report: plan, now: entry.date)
                            } else {
                                PlanMeterRow(report: plan, now: entry.date)
                            }
                        }
                        .frame(maxHeight: .infinity)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, family == .systemLarge ? 10 : 4)
            }
        }
        .usageBackground(plan: plans.count == 1 ? plans.first?.plan : nil)
    }
}

struct Hairline: View {
    var body: some View {
        Rectangle().fill(.primary.opacity(0.1)).frame(height: 0.5)
    }
}

/// A plan in the medium widget: mark, name, window and figure; the meter; when it resets and its pace.
struct PlanMeterRow: View {
    let report: PlanReport
    let now: Date

    var body: some View {
        if let window = report.headline(at: now) {
            VStack(spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    PlanGlyph(plan: report.plan, size: 13)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
                    Text(report.plan.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(report.plan.bright)
                    Text(window.label)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    HeroPercent(used: window.used(at: now), size: 24, color: report.plan.bright)
                }
                TickMeter(plan: report.plan, window: window, now: now, height: 16)
                HStack(spacing: 4) {
                    if let resetsAt = window.resetsAt, resetsAt > now {
                        Image(systemName: "arrow.counterclockwise")
                        TimeLeft(resetsAt: resetsAt, now: now)
                    }
                    Spacer(minLength: 4)
                    if let pace = window.pace(at: now) {
                        PaceBadge(plan: report.plan, pace: pace, span: window.span, plain: true)
                    }
                }
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }
}

/// A plan in the large widget.
struct PlanPanel: View {
    let report: PlanReport
    let now: Date

    var body: some View {
        if let window = report.headline(at: now) {
            VStack(spacing: 8) {
                PlanTitle(report: report, now: now, trailing: report.tier)
                HStack(alignment: .firstTextBaseline) {
                    Text(window.label)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                    if let pace = window.pace(at: now) {
                        PaceBadge(plan: report.plan, pace: pace, span: window.span, plain: true)
                            .font(.system(size: 10.5, weight: .semibold))
                    }
                    Spacer()
                    HeroPercent(used: window.used(at: now), size: 30, color: report.plan.bright)
                }
                TickMeter(plan: report.plan, window: window, now: now, height: 20)
                TimeTrack(plan: report.plan, window: window, now: now)
                OtherWindows(
                    plan: report.plan,
                    windows: Array(report.windows.filter { $0.id != window.id }.prefix(3)),
                    now: now)
            }
            .padding(.vertical, 4)
        }
    }
}
