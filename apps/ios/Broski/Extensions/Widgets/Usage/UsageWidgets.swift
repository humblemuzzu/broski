import SwiftUI
import WidgetKit

/// Opens the app's Usage tab.
let usageURL = URL(string: "broski://usage")

/// One plan, Claude or any other the Macs read: what is left of its limits on the Home Screen; a
/// gauge, a bar or a line on the Lock Screen.
struct PlanUsageWidget: Widget {
    static let kind = "PlanUsage"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: PlanChoice.self, provider: PlanUsageProvider()) { entry in
            PlanUsageView(entry: entry)
                .widgetURL(usageURL)
        }
        .configurationDisplayName("Plan Usage")
        .description("What's left of a plan's limits.")
        .supportedFamilies([
            .systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline,
        ])
        .contentMarginsDisabled()
        .containerBackgroundRemovable(true)
    }
}

/// Every plan at once.
struct AllPlansWidget: Widget {
    static let kind = "AllPlans"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: AllPlansProvider()) { entry in
            AllPlansView(entry: entry)
                .widgetURL(usageURL)
        }
        .configurationDisplayName("All Plans")
        .description("What's left of each plan.")
        .supportedFamilies([.systemMedium, .systemLarge])
        .contentMarginsDisabled()
        .containerBackgroundRemovable(true)
    }
}

private struct PlanUsageView: View {
    let entry: UsageEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if let report = entry.planReport, let window = report.headline(at: entry.date) {
                switch family {
                case .accessoryCircular: PlanCircular(report: report, window: window, now: entry.date)
                case .accessoryRectangular: PlanRectangular(report: report, window: window, now: entry.date)
                case .accessoryInline: PlanInline(report: report, window: window, now: entry.date)
                case .systemMedium: PlanMedium(report: report, now: entry.date)
                default: PlanSmall(report: report, window: window, now: entry.date)
                }
            } else {
                NoReading(plan: entry.plan, report: entry.planReport, hasReport: entry.report != nil)
                    .padding(family.isAccessory ? 0 : 16)
            }
        }
        .usageBackground()
    }
}

/// Why there is nothing to draw: the app has not read the plans yet, the plan is not signed in on
/// the Mac, or the Mac could not read it.
struct NoReading: View {
    let plan: UsagePlan
    let report: PlanReport?
    let hasReport: Bool
    @Environment(\.widgetFamily) private var family

    private var name: String { report?.name ?? plan.name }

    private var message: String {
        if let problem = report?.problem { return problem }
        return hasReport ? "Not signed in on your Mac" : "Open Broski to read your plans"
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("\(name): \(hasReport ? "no reading" : "open Broski")")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                PlanGlyph(plan: plan, name: name, size: 22)
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    PlanGlyph(plan: plan, name: name, size: 14)
                    Text(name).font(.system(size: 13, weight: .semibold))
                }
                Spacer(minLength: 0)
                Text(message)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

extension View {
    /// The Home Screen's plain backdrop, white in the light and graphite in the dark. The system takes
    /// it away for a tinted or clear Home Screen and the Lock Screen.
    func usageBackground() -> some View {
        containerBackground(for: .widget) {
            UsageBackdrop()
        }
    }
}

private struct UsageBackdrop: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family.isAccessory {
            Color.clear
        } else {
            Color(light: 0xFFFFFF, dark: 0x1C1C1E)
        }
    }
}

extension WidgetFamily {
    var isAccessory: Bool {
        switch self {
        case .accessoryCircular, .accessoryRectangular, .accessoryInline: true
        default: false
        }
    }
}
