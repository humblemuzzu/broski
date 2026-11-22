import AppIntents
import WidgetKit

/// What a usage widget draws at `date`: the app's last report (the gallery's sample before there is
/// one) and the plan the person picked.
nonisolated struct UsageEntry: TimelineEntry {
    let date: Date
    let report: UsageReport?
    let plan: UsagePlan
    var isPreview = false

    var planReport: PlanReport? { report?.plan(plan) }
}

/// The widget's timeline from the stored report: an entry now and one at each reset within a day, so
/// a window empties on time without the app. The app reloads the timelines whenever it reads anew.
nonisolated enum UsageTimeline {
    static let maxResets = 8

    static func entries(plan: UsagePlan, now: Date = .now) -> Timeline<UsageEntry> {
        let report = UsageStore.shared.load()
        let horizon = now.addingTimeInterval(24 * 3600)
        let resets = report?.resets(after: now).filter { $0 <= horizon }.prefix(maxResets) ?? []
        let dates = [now] + resets.map { $0.addingTimeInterval(1) }
        return Timeline(
            entries: dates.map { UsageEntry(date: $0, report: report, plan: plan) },
            policy: .after(now.addingTimeInterval(3600)))
    }

    static func preview(plan: UsagePlan, in context: TimelineProviderContext) -> UsageEntry {
        let now = Date.now
        if !context.isPreview, let report = UsageStore.shared.load() {
            return UsageEntry(date: now, report: report, plan: plan)
        }
        return UsageEntry(date: now, report: .sample(at: now), plan: plan, isPreview: true)
    }
}

/// The plan widget's provider: the plan comes from the widget's configuration.
nonisolated struct PlanUsageProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> UsageEntry {
        UsageEntry(date: .now, report: .sample(), plan: .claude, isPreview: true)
    }

    func snapshot(for configuration: PlanChoice, in context: Context) async -> UsageEntry {
        UsageTimeline.preview(plan: configuration.plan.plan, in: context)
    }

    func timeline(for configuration: PlanChoice, in context: Context) async -> Timeline<UsageEntry> {
        UsageTimeline.entries(plan: configuration.plan.plan)
    }
}

/// The every-plan widget's provider; `plan` is unused there.
nonisolated struct AllPlansProvider: TimelineProvider {
    func placeholder(in context: Context) -> UsageEntry {
        UsageEntry(date: .now, report: .sample(), plan: .claude, isPreview: true)
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (UsageEntry) -> Void) {
        completion(UsageTimeline.preview(plan: .claude, in: context))
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<UsageEntry>) -> Void) {
        completion(UsageTimeline.entries(plan: .claude))
    }
}

/// The plan widget's one setting.
struct PlanChoice: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Plan"
    static let description = IntentDescription("The plan this widget shows.")

    @Parameter(title: "Plan", default: .claude) var plan: PlanOption

    init() {}

    init(plan: PlanOption) {
        self.plan = plan
    }
}

/// The plans the widget can be set to, by the contract's plan id.
enum PlanOption: String, AppEnum {
    case claude
    case antigravity

    nonisolated static let typeDisplayRepresentation: TypeDisplayRepresentation = "Plan"
    nonisolated static let caseDisplayRepresentations: [PlanOption: DisplayRepresentation] = [
        .claude: DisplayRepresentation(title: "Claude", subtitle: "Your claude.ai plan"),
        .antigravity: DisplayRepresentation(title: "Antigravity", subtitle: "Google Antigravity's plan"),
    ]

    var plan: UsagePlan { UsagePlan(id: rawValue) }
}
