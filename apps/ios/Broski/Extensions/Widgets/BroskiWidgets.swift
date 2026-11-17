import SwiftUI
import WidgetKit

@main
struct BroskiWidgets: WidgetBundle {
    var body: some Widget {
        RunActivityWidget()
    }
}

/// The Live Activity on the Lock Screen and in the Dynamic Island: the agent's logo, the session's
/// title, how long it has been live, its state, and Stop.
struct RunActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunActivityAttributes.self) { context in
            LockScreenRun(state: context.state)
                .padding(16)
                .activityBackgroundTint(ActivityStyle.background)
                .activitySystemActionForegroundColor(ActivityStyle.primary)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    AgentLogo(brand: state.brand, side: 44)
                        .padding(.leading, 4)
                        .frame(maxHeight: .infinity)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Group {
                        if state.phase == .done {
                            PhaseIcon(phase: .done).font(.title2)
                        } else {
                            Elapsed(state: state)
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(ActivityStyle.primary)
                                .multilineTextAlignment(.trailing)
                                .frame(maxWidth: 96, alignment: .trailing)
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
                if state.phase == .working {
                    Elapsed(state: state)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(state.phase.tint)
                        .frame(maxWidth: 52)
                } else {
                    PhaseIcon(phase: state.phase)
                }
            } minimal: {
                if state.phase == .working {
                    AgentGlyph(brand: state.brand, side: 20)
                } else {
                    PhaseIcon(phase: state.phase)
                }
            }
            .keylineTint(state.phase.tint)
        }
    }
}
