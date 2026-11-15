import SwiftUI
import WidgetKit

@main
struct BroskiWidgets: WidgetBundle {
    var body: some Widget {
        RunActivityWidget()
    }
}

/// The Live Activity on the Lock Screen and in the Dynamic Island: the agent, the session's title,
/// how long it has been live, its state, and Stop.
struct RunActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunActivityAttributes.self) { context in
            LockScreenRun(state: context.state)
                .padding(16)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    AgentTile(state: state, side: 36)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if state.phase == .done {
                        PhaseIcon(phase: .done).font(.title3)
                    } else {
                        Elapsed(state: state)
                            .font(.title3.weight(.semibold))
                            .frame(maxWidth: 96, alignment: .trailing)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(state.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        PhaseLabel(phase: state.phase)
                        if state.liveCount > 1 {
                            Text(state.summary).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        StopButton(state: state)
                    }
                }
            } compactLeading: {
                AgentTile(state: state, side: 22)
            } compactTrailing: {
                if state.phase == .working {
                    Elapsed(state: state).frame(maxWidth: 52)
                } else {
                    PhaseIcon(phase: state.phase)
                }
            } minimal: {
                PhaseIcon(phase: state.phase)
            }
            .keylineTint(state.phase.tint)
        }
    }
}
