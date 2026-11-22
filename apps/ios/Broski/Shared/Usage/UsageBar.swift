import SwiftUI
import WidgetKit

/// What is left of a limit as a filled capsule in the plan's muted colour, and a thin mark where an
/// even pace would leave it: fill past the mark means room to spare. The app's Usage tab and the
/// widgets draw the same bar.
struct UsageBar: View {
    let plan: UsagePlan
    let window: LimitWindow
    let now: Date
    var height: CGFloat = 10

    var body: some View {
        let left = window.left(at: now)
        let evenPace = window.elapsed(at: now).map { 1 - $0 }
        GeometryReader { proxy in
            let width = proxy.size.width
            let mark = max(2, height * 0.25)
            ZStack(alignment: .leading) {
                Capsule().fill(.primary.opacity(0.1))
                if left > 0 {
                    Capsule()
                        .fill(plan.tint.opacity(0.6))
                        .frame(width: max(height, width * left))
                        .widgetAccentable()
                }
                if let evenPace {
                    Capsule()
                        .fill(.primary)
                        .frame(width: mark, height: height * 1.9)
                        .offset(x: min(max(0, width * evenPace - mark / 2), width - mark))
                }
            }
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

nonisolated extension LimitWindow {
    /// Left, 0 to 1.
    func left(at now: Date) -> Double { 1 - used(at: now) }

    /// "83%".
    func leftPercent(at now: Date) -> String { "\(Int((left(at: now) * 100).rounded()))%" }

    /// What a window covers, in a few words: "Weekly", "Weekly · Fable", "5-hour · Gemini".
    var label: String {
        shortScope.map { "\(span.title) · \($0)" } ?? span.title
    }

    /// "On pace", "Runs out Thu 12 PM"; nil while too little of the window has passed to say.
    func paceWords(at now: Date) -> String? {
        switch pace(at: now) {
        case .under: "Under pace"
        case .steady: "On pace"
        case .over: "Ahead of pace"
        case .runsOut(let date): "Runs out \(date.formatted(Self.moment(date, now: now)))"
        case nil: nil
        }
    }

    /// "Resets 9:47 PM" today, "Resets Sun 2:30 AM" beyond: a time, not a countdown, so a widget
    /// never shows one gone stale.
    func resetWords(at now: Date) -> String {
        guard let resetsAt, resetsAt > now else { return used(at: now) == 0 ? "Not started" : "Started over" }
        return "Resets \(resetsAt.formatted(Self.moment(resetsAt, now: now)))"
    }

    private static func moment(_ date: Date, now: Date) -> Date.FormatStyle {
        Calendar.current.isDate(date, inSameDayAs: now)
            ? .dateTime.hour().minute() : .dateTime.weekday(.abbreviated).hour().minute()
    }
}

nonisolated extension PlanReport {
    /// Its limits as they read best: each scope in the order the plan gives them, the whole plan
    /// first, its five-hour limit before its week.
    var orderedWindows: [LimitWindow] {
        var scopes: [String?] = [nil]
        for window in windows where !scopes.contains(window.scope) { scopes.append(window.scope) }
        return windows.sorted {
            let (left, right) = (scopes.firstIndex(of: $0.scope) ?? 0, scopes.firstIndex(of: $1.scope) ?? 0)
            return (left, $0.span == .week ? 1 : 0) < (right, $1.span == .week ? 1 : 0)
        }
    }
}
