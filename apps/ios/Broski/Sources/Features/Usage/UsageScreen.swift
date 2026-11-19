import SwiftUI
import ThinkingOrbsKit

/// How much of each plan the Macs' agents run on is used: Claude's and Antigravity's limits as the
/// Macs read them, the same reading the widgets draw. Pull to read again.
struct UsageScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            if let report = model.usage.report, !report.plans.isEmpty {
                TimelineView(.everyMinute) { context in
                    VStack(spacing: Spacing.l) {
                        ForEach(report.plans) { plan in
                            PlanUsageCard(report: plan, now: context.date)
                        }
                        Label(
                            "Add the Plan Usage or All Plans widget to your Home Screen or Lock Screen. The tick on each ring and bar is where an even pace would be.",
                            systemImage: "square.grid.2x2"
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, Spacing.xs)
                    }
                    .padding(Spacing.l)
                }
            } else {
                ContentUnavailableView {
                    Label("No plans read yet", systemImage: "gauge.with.needle")
                } description: {
                    Text(emptyDescription)
                }
                .padding(.top, Spacing.xxxl)
            }
        }
        .background(Palette.screen)
        .navigationTitle("Plan Usage")
        .refreshable { await model.usage.refresh(from: model.machines, force: true) }
        .toolbar {
            if model.usage.isReading {
                ToolbarItem(placement: .primaryAction) { LoadingOrb(state: .working, label: "Reading usage") }
            }
        }
        .task { await model.usage.refresh(from: model.machines) }
    }

    private var emptyDescription: String {
        if !model.machines.contains(where: \.summary.isReady) {
            return "Broski reads your plans from your Mac once it's connected."
        }
        return "Your Mac reads the Claude and Antigravity sign-ins of Claude Code, agy and Pi. Sign in to one there, then pull to read again."
    }
}
