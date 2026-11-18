import SwiftUI
import WidgetKit

/// Opens the app's Plan Usage screen.
let usageURL = URL(string: "broski://usage")

/// One plan, Claude or Antigravity: on the Home Screen its fullest window as a figure over its burn
/// chart; on the Lock Screen a gauge, a figure with a sparkline, or a line.
struct PlanUsageWidget: Widget {
    static let kind = "PlanUsage"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: PlanChoice.self, provider: PlanUsageProvider()) { entry in
            PlanUsageView(entry: entry)
                .widgetURL(usageURL)
        }
        .configurationDisplayName("Plan Usage")
        .description("How much of your Claude or Antigravity plan is used, its pace, and when it resets.")
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
        .description("Claude and Antigravity together: each plan's burn, its pace, and when it resets.")
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
                case .systemMedium: PlanMedium(report: report, window: window, now: entry.date)
                default: PlanSmall(report: report, window: window, now: entry.date)
                }
            } else {
                NoReading(plan: entry.plan, report: entry.planReport, hasReport: entry.report != nil)
                    .padding(family.isAccessory ? 0 : 16)
            }
        }
        .usageBackground(plan: entry.plan)
    }
}

/// Why there is nothing to draw: the app has not read the plans yet, the plan is not signed in on
/// the Mac, or the Mac could not read it.
struct NoReading: View {
    let plan: UsagePlan
    let report: PlanReport?
    let hasReport: Bool
    @Environment(\.widgetFamily) private var family

    private var message: String {
        if let problem = report?.problem { return problem }
        return hasReport ? "Not signed in on your Mac" : "Open Broski to read your plans"
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text("\(plan.name): \(hasReport ? "no reading" : "open Broski")")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                PlanGlyph(plan: plan, size: 22)
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    PlanGlyph(plan: plan, size: 13)
                    Eyebrow(plan.name, style: .primary)
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
    /// The Home Screen's backdrop: near black in the dark, white in the light, with a faint glow of the
    /// plan's colour. The system takes it away for a tinted or clear Home Screen and the Lock Screen.
    func usageBackground(plan: UsagePlan?) -> some View {
        containerBackground(for: .widget) {
            UsageBackdrop(plan: plan)
        }
    }
}

private struct UsageBackdrop: View {
    let plan: UsagePlan?
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        if family.isAccessory {
            Color.clear
        } else {
            let tint = (plan ?? .claude).tint
            ZStack {
                Color(light: 0xFFFFFF, dark: 0x0A0A0C)
                RadialGradient(
                    colors: [tint.opacity(colorScheme == .dark ? 0.12 : 0.06), .clear],
                    center: .topLeading, startRadius: 0, endRadius: 200)
            }
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
