import Foundation

/// The plans' usage as the app last read it from the Macs, kept in the app group for the widgets.
/// Its own values, not the core's: the widget extension does not link BroskiCore.
nonisolated struct UsageReport: Codable, Equatable, Sendable {
    var plans: [PlanReport]
    var savedAt: Date

    func plan(_ plan: UsagePlan) -> PlanReport? {
        plans.first { $0.plan == plan }
    }

    /// When a window starts over after `now`, soonest first: a widget redraws then with that
    /// window empty, without waiting for a new reading.
    func resets(after now: Date) -> [Date] {
        Set(plans.flatMap(\.windows).compactMap(\.resetsAt).filter { $0 > now }).sorted()
    }
}

/// A plan by the contract's id: `claude`, `antigravity`, or any other a bridge meters. Stored as
/// the bare id.
nonisolated struct UsagePlan: Codable, Hashable, Sendable, Identifiable {
    static let claude = UsagePlan(id: "claude")
    static let antigravity = UsagePlan(id: "antigravity")

    let id: String

    init(id: String) {
        self.id = id
    }

    init(from decoder: Decoder) throws {
        id = try decoder.singleValueContainer().decode(String.self)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(id)
    }

    /// What the phone calls a plan its bridge did not name: "claude" reads "Claude".
    var name: String { Slug.label(id) }
}

/// One plan on one Mac: its windows, or why the Mac could not read them this time (the windows
/// are then those of the last reading that worked).
nonisolated struct PlanReport: Codable, Equatable, Sendable, Identifiable {
    var plan: UsagePlan
    /// The bridge's name for the plan, when it gives one.
    var displayName: String?
    var tier: String?
    var windows: [LimitWindow]
    var readAt: Date?
    var problem: String?
    var machineName: String

    var id: UsagePlan { plan }

    var name: String { displayName ?? plan.name }

    /// The window nearest its limit, the week on a tie: what a glance should show.
    func headline(at now: Date) -> LimitWindow? {
        windows.max { lhs, rhs in
            let (left, right) = (lhs.used(at: now), rhs.used(at: now))
            return left == right ? lhs.span == .week && rhs.span == .fiveHour : left < right
        }
    }

    /// The fullest window of `span`, which a ring of that span draws.
    func fullest(_ span: LimitSpan, at now: Date) -> LimitWindow? {
        windows.filter { $0.span == span }.max { $0.used(at: now) < $1.used(at: now) }
    }

    /// A reading this old may no longer be true.
    func isStale(at now: Date) -> Bool {
        guard let readAt else { return true }
        return now.timeIntervalSince(readAt) > 2 * 3600
    }
}

nonisolated enum LimitSpan: String, Codable, Sendable {
    case fiveHour
    case week

    var duration: TimeInterval {
        switch self {
        case .fiveHour: 5 * 3600
        case .week: 7 * 24 * 3600
        }
    }

    var title: String {
        switch self {
        case .fiveHour: "5-hour"
        case .week: "Weekly"
        }
    }

    var shortTitle: String {
        switch self {
        case .fiveHour: "5h"
        case .week: "Week"
        }
    }
}

/// A window's use at one moment, as the Mac read it.
nonisolated struct UsagePoint: Codable, Equatable, Sendable {
    var at: Date
    var usedPercent: Double
}

/// One allowance: how much of it is used, when it starts over, and what the Mac read of it since it last did.
nonisolated struct LimitWindow: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var span: LimitSpan
    /// The model or group of models it covers, when not the whole plan.
    var scope: String?
    var usedPercent: Double
    var resetsAt: Date?
    var history: [UsagePoint] = []

    enum Severity: Sendable {
        case normal
        case high
        case critical
    }

    /// Where use stands against an even spread across the window.
    enum Pace: Equatable, Sendable {
        case under
        case steady
        case over
        case runsOut(Date)
    }

    var start: Date? { resetsAt?.addingTimeInterval(-span.duration) }

    /// The scope as a label holds it: "Claude and GPT" reads "Claude + GPT".
    var shortScope: String? { scope?.replacingOccurrences(of: " and ", with: " + ") }

    var title: String {
        scope.map { "\(span.title) · \($0)" } ?? span.title
    }

    /// Used, 0 to 1. A window past its reset has started over, and nothing is known to be used in it.
    func used(at now: Date) -> Double {
        if let resetsAt, resetsAt <= now { return 0 }
        return min(1, max(0, usedPercent / 100))
    }

    /// How far through the window `now` is, 0 to 1; nil when its end is unknown or passed.
    func elapsed(at now: Date) -> Double? {
        guard let resetsAt, resetsAt > now else { return nil }
        return min(1, max(0, 1 - resetsAt.timeIntervalSince(now) / span.duration))
    }

    /// When the window runs out if use goes on at its pace so far; nil when it lasts to its reset.
    /// Too early in a window or too little used, the pace says nothing yet.
    func runsOut(at now: Date) -> Date? {
        let used = used(at: now)
        guard let resetsAt, let elapsed = elapsed(at: now), used >= 0.05, used < 1, elapsed >= 0.05 else { return nil }
        let rate = used / (elapsed * span.duration)
        let out = now.addingTimeInterval((1 - used) / rate)
        return out < resetsAt ? out : nil
    }

    /// Nil while too little of the window has passed to say.
    func pace(at now: Date) -> Pace? {
        guard let elapsed = elapsed(at: now), elapsed >= 0.05 else { return nil }
        if let out = runsOut(at: now) { return .runsOut(out) }
        let ahead = used(at: now) - elapsed
        return ahead > 0.05 ? .over : ahead < -0.05 ? .under : .steady
    }

    /// The readings to chart, oldest first, ending with the latest; empty once the window has started over.
    func trace(at now: Date) -> [UsagePoint] {
        guard let start, let resetsAt, resetsAt > now else { return [] }
        let known = history.filter { $0.at >= start && $0.at <= now }.sorted { $0.at < $1.at }
        return known.isEmpty ? [UsagePoint(at: now, usedPercent: usedPercent)] : known
    }

    func severity(at now: Date) -> Severity {
        let used = used(at: now)
        if used >= 0.9 { return .critical }
        if used >= 0.75 || runsOut(at: now) != nil { return .high }
        return .normal
    }
}

nonisolated extension UsageReport {
    /// What the widget gallery and placeholders show before there is a reading: plausible days of work,
    /// quiet nights included.
    static func sample(at now: Date = .now) -> UsageReport {
        let hours = { (count: Double) in now.addingTimeInterval(count * 3600) }
        func traced(_ window: LimitWindow) -> LimitWindow {
            guard let start = window.start else { return window }
            let steps = 48
            var level = 0.0
            var points: [UsagePoint] = []
            let raw = (0...steps).map { step -> Double in
                let x = Double(step) / Double(steps)
                return max(0, sin(x * .pi * 9)) * (0.6 + 0.4 * x)
            }
            let total = max(raw.reduce(0, +), 0.0001)
            for (step, weight) in raw.enumerated() {
                level += weight / total * window.usedPercent
                let at = start.addingTimeInterval(now.timeIntervalSince(start) * Double(step) / Double(steps))
                points.append(UsagePoint(at: at, usedPercent: min(window.usedPercent, level)))
            }
            var traced = window
            traced.history = points
            return traced
        }
        return UsageReport(
            plans: [
                PlanReport(
                    plan: .claude, tier: "Max 5x",
                    windows: [
                        LimitWindow(id: "session", span: .fiveHour, usedPercent: 38, resetsAt: hours(2.6)),
                        LimitWindow(id: "weekly_all", span: .week, usedPercent: 55, resetsAt: hours(75)),
                        LimitWindow(id: "weekly_scoped:Fable", span: .week, scope: "Fable", usedPercent: 12, resetsAt: hours(75)),
                    ].map(traced),
                    readAt: now, machineName: "Mac"),
                PlanReport(
                    plan: .antigravity, tier: "Google AI Ultra",
                    windows: [
                        LimitWindow(id: "gemini-5h", span: .fiveHour, scope: "Gemini", usedPercent: 10, resetsAt: hours(1.1)),
                        LimitWindow(id: "gemini-weekly", span: .week, scope: "Gemini", usedPercent: 4, resetsAt: hours(159)),
                        LimitWindow(id: "3p-5h", span: .fiveHour, scope: "Claude and GPT", usedPercent: 0, resetsAt: hours(5)),
                        LimitWindow(id: "3p-weekly", span: .week, scope: "Claude and GPT", usedPercent: 1, resetsAt: hours(159)),
                    ].map(traced),
                    readAt: now, machineName: "Mac"),
            ],
            savedAt: now)
    }
}
