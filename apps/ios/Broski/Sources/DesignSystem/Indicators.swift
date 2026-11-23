import BroskiCore
import SwiftUI
import ThinkingOrbsKit

/// The trailing mark of a session row: an accent dot for needs you, a working orb for working, a
/// green dot for done (unseen), nothing for idle. The row's own label says the state in words, so
/// this is hidden from VoiceOver.
struct StateIndicator: View {
    let state: InboxState
    @ScaledMetric(relativeTo: .body) private var dot: CGFloat = 10
    @ScaledMetric(relativeTo: .body) private var width: CGFloat = 18

    var body: some View {
        Group {
            switch state {
            case .needsYou, .done:
                Circle().fill(state.tint).frame(width: dot, height: dot)
            case .working:
                Orb(.working, side: 18)
            case .idle:
                Color.clear.frame(width: dot, height: dot)
            }
        }
        .frame(width: width)
        .accessibilityHidden(true)
    }
}

/// "2 min ago", kept current once a minute; a time a moment ahead of this phone's clock reads as now.
struct RelativeTime: View {
    let date: Date

    var body: some View {
        TimelineView(.everyMinute) { context in
            Text(min(date, context.date), format: .relative(presentation: .named, unitsStyle: .abbreviated))
        }
    }
}

/// A row's age in as few characters as read: "now", "5m", "2h", "3d", then the day itself.
struct ShortAge: View {
    let date: Date

    var body: some View {
        TimelineView(.everyMinute) { context in
            Text(Self.text(date, now: context.date))
                .monospacedDigit()
        }
    }

    static func text(_ date: Date, now: Date) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        switch seconds {
        case ..<60: return "now"
        case ..<3_600: return "\(Int(seconds / 60))m"
        case ..<86_400: return "\(Int(seconds / 3_600))h"
        case ..<(30 * 86_400): return "\(Int(seconds / 86_400))d"
        default:
            let sameYear = Calendar.current.isDate(date, equalTo: now, toGranularity: .year)
            return date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).year())
        }
    }
}

nonisolated extension Date {
    init(unixMilliseconds: Int64) {
        self.init(timeIntervalSince1970: TimeInterval(unixMilliseconds) / 1000)
    }

    var unixMilliseconds: Int64 { Int64((timeIntervalSince1970 * 1000).rounded()) }
}
