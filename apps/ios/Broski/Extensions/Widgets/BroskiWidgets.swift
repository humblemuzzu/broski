import SwiftUI
import WidgetKit

@main
struct BroskiWidgets: WidgetBundle {
    var body: some Widget {
        RunActivityWidget()
        PlanUsageWidget()
        AllPlansWidget()
    }
}

/// The Live Activity on the Lock Screen and in the Dynamic Island: the agent's logo, the session's
/// title, how long it has been live, its state, and Stop.
struct RunActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunActivityAttributes.self) { context in
            LockScreenRun(state: context.state, isStale: context.isStale)
                .padding(16)
                .activityBackgroundTint(ActivityStyle.background)
                .activitySystemActionForegroundColor(ActivityStyle.primary)
                .widgetURL(context.state.deepLinkURL)
        } dynamicIsland: { context in
            let state = context.state
            let isStale = context.isStale
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    AgentLogo(brand: state.brand, side: 44)
                        .padding(.leading, 4)
                        .frame(maxHeight: .infinity)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Group {
                        if state.phase == .working || (state.phase == .done && state.endedAt != nil) {
                            Elapsed(state: state, isStale: isStale)
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(ActivityStyle.primary)
                                .multilineTextAlignment(.trailing)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                                .frame(maxWidth: 96, alignment: .trailing)
                        } else {
                            PhaseIcon(phase: state.phase).font(.title2)
                        }
                    }
                    .padding(.trailing, 4)
                    .frame(maxHeight: .infinity)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text(state.title).font(.headline).foregroundStyle(ActivityStyle.primary).lineLimit(1)
                        Text("\(state.machineName) · \(state.agentName)")
                            .font(.caption)
                            .foregroundStyle(ActivityStyle.secondary)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 8) {
                        PhasePill(phase: state.phase)
                        if state.liveCount > 1 {
                            Text(state.summary).font(.footnote).foregroundStyle(ActivityStyle.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        StopButton(state: state)
                    }
                    .padding(.top, 6)
                }
            } compactLeading: {
                AgentGlyph(brand: state.brand, side: 22)
            } compactTrailing: {
                CompactTrailingRun(state: state, isStale: isStale)
            } minimal: {
                if state.phase == .working {
                    AgentGlyph(brand: state.brand, side: 20)
                } else {
                    PhaseIcon(phase: state.phase)
                }
            }
            .widgetURL(state.deepLinkURL)
            .keylineTint(state.phase.tint)
        }
    }
}

private struct CompactTrailingRun: View {
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
        if limitedWidth || isStale {
            PhaseIcon(phase: state.phase)
        } else if state.phase == .working {
            Elapsed(state: state, isStale: false)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(state.phase.tint)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: 52, alignment: .trailing)
        } else {
            PhaseIcon(phase: state.phase)
        }
    }
}
