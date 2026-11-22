import SwiftUI
import WidgetKit

/// The first two plans the Macs read. Medium: a column each, its fullest limit; one plan alone shows
/// two of its limits. Large: each plan with its first two limits side by side.
struct AllPlansView: View {
    let entry: UsageEntry
    @Environment(\.widgetFamily) private var family

    private var plans: [PlanReport] {
        Array((entry.report?.plans ?? []).filter { !$0.windows.isEmpty }.prefix(2))
    }

    var body: some View {
        Group {
            if plans.isEmpty {
                NoReading(plan: .claude, report: nil, hasReport: entry.report != nil)
                    .padding(16)
            } else if family == .systemLarge {
                VStack(alignment: .leading, spacing: 24) {
                    ForEach(plans) { PlanBlock(report: $0, now: entry.date) }
                }
                .padding(16)
                .frame(maxHeight: .infinity, alignment: .top)
            } else if plans.count == 1, let only = plans.first {
                PlanMedium(report: only, now: entry.date)
            } else {
                HStack(alignment: .top, spacing: 20) {
                    ForEach(plans) { PlanColumn(report: $0, now: entry.date) }
                }
                .padding(16)
                .frame(maxHeight: .infinity)
            }
        }
        .usageBackground()
    }
}

/// A plan in the medium widget: its mark and name over its fullest limit.
private struct PlanColumn: View {
    let report: PlanReport
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlanHeader(report: report, now: now)
            Spacer(minLength: 8)
            if let window = report.headline(at: now) {
                LimitColumn(report: report, window: window, now: now, figure: 28)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// A plan in the large widget: its header, then its first two limits side by side.
private struct PlanBlock: View {
    let report: PlanReport
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            PlanHeader(report: report, now: now, showsTier: true)
            HStack(alignment: .bottom, spacing: 20) {
                ForEach(report.orderedWindows.prefix(2)) { window in
                    LimitColumn(report: report, window: window, now: now)
                }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }
}
