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

/// The Live Activity on the Lock Screen and in the Dynamic Island: the focused session while it is
/// the only one live (its agent, title, state, time and Stop), and how many run while several do.
struct RunActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunActivityAttributes.self) { context in
            LockScreenRun(state: context.state, isStale: context.isStale)
                .padding(.horizontal, 18)
                .padding(.vertical, 16)
                .widgetURL(context.state.deepLinkURL)
        } dynamicIsland: { context in
            let state = context.state
            let isStale = context.isStale
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    AgentLogo(brand: state.brand, side: 40)
                        .padding(.leading, 4)
                        .frame(maxHeight: .infinity)
                        .islandInk()
                }
                DynamicIslandExpandedRegion(.trailing) {
                    IslandTrailing(state: state)
                        .padding(.trailing, 4)
                        .frame(maxHeight: .infinity)
                        .islandInk()
                }
                DynamicIslandExpandedRegion(.center) {
                    IslandCenter(state: state, isStale: isStale)
                        .islandInk()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if state.isMany {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(state.runs.prefix(3).enumerated()), id: \.offset) { _, run in
                                RunLine(run: run, showsMachine: state.spansMachines)
                            }
                        }
                        .padding(.top, 6)
                        .padding(.horizontal, 4)
                        .islandInk()
                    }
                }
            } compactLeading: {
                AgentGlyph(brand: state.brand, side: 22)
            } compactTrailing: {
                CompactTrailingRun(state: state, isStale: isStale)
                    .islandInk()
            } minimal: {
                Group {
                    if state.isMany {
                        CountBadge(state: state)
                    } else if state.phase == .working {
                        AgentGlyph(brand: state.brand, side: 20)
                    } else {
                        PhaseIcon(phase: state.phase)
                    }
                }
                .islandInk()
            }
            .widgetURL(state.deepLinkURL)
            .keylineTint(state.phase.keyline)
        }
    }
}
