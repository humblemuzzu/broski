import SwiftUI
import WidgetKit

/// The expanded island's middle: the focused session's title and state, or how many run and how
/// many need the person.
struct IslandCenter: View {
    let state: RunState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if state.isMany {
                Text(state.countLine)
                    .font(.headline)
                    .lineLimit(1)
                if let needsYou = state.needsYouLine {
                    Text(needsYou)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(RunState.Phase.needsYou.tint)
                        .lineLimit(1)
                }
            } else {
                Text(state.title)
                    .font(.headline)
                    .lineLimit(1)
                StatusLine(state: state, isStale: isStale)
                    .font(.caption)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Stop beside a single live run; the count beside several.
struct IslandTrailing: View {
    let state: RunState

    var body: some View {
        if state.isMany {
            CountBadge(state: state, side: 36)
        } else {
            StopButton(state: state, side: 36)
        }
    }
}

/// How many sessions run, on a disc orange while any needs the person.
struct CountBadge: View {
    let state: RunState
    var side: CGFloat = 22

    var body: some View {
        Text(state.liveCount, format: .number)
            .font(.system(size: side * 0.5, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(state.needsYouCount > 0 ? Color.black : Color.white)
            .frame(width: side, height: side)
            .background(state.needsYouCount > 0 ? Color.orange : Color.white.opacity(0.18), in: .circle)
            .accessibilityLabel(state.needsYouLine.map { "\(state.countLine), \($0)" } ?? state.countLine)
    }
}

/// The compact island's right side: the count while several run, otherwise the focused run's time
/// while it works, or its state.
struct CompactTrailingRun: View {
    let state: RunState
    let isStale: Bool

    var body: some View {
        if #available(iOS 27.0, *) {
            AdaptiveCompactTrailingRun(state: state, isStale: isStale)
        } else {
            CompactTrailingBody(state: state, isStale: isStale, limitedWidth: false)
        }
    }
}

@available(iOS 27.0, *)
private struct AdaptiveCompactTrailingRun: View {
    let state: RunState
    let isStale: Bool
    @Environment(\.isDynamicIslandLimitedInWidth) private var limitedWidth

    var body: some View {
        CompactTrailingBody(state: state, isStale: isStale, limitedWidth: limitedWidth)
    }
}

private struct CompactTrailingBody: View {
    let state: RunState
    let isStale: Bool
    let limitedWidth: Bool

    var body: some View {
        if state.isMany {
            CountBadge(state: state)
        } else if limitedWidth || isStale || state.phase != .working {
            PhaseIcon(phase: state.phase)
        } else {
            Elapsed(state: state, isStale: false)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: 52, alignment: .trailing)
        }
    }
}
