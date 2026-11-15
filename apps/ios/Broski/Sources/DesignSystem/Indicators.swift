import BroskiCore
import SwiftUI

/// The trailing mark of a session row: an accent dot for needs you, a live symbol for working, a
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
                LiveIndicator()
            case .idle:
                Color.clear.frame(width: dot, height: dot)
            }
        }
        .frame(width: width)
        .accessibilityHidden(true)
    }
}

/// Work under way: a small symbol whose layers pulse. Symbol effects stop with the view, so only
/// rows on screen animate.
struct LiveIndicator: View {
    var body: some View {
        Image(systemName: "waveform")
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Palette.working)
            .symbolEffect(.variableColor.iterative, options: .repeating)
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

extension Date {
    init(unixMilliseconds: Int64) {
        self.init(timeIntervalSince1970: TimeInterval(unixMilliseconds) / 1000)
    }
}
