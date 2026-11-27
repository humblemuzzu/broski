import SwiftUI
import ThinkingOrbsKit

private enum UsageSectionTab: String, CaseIterable, Identifiable {
    case stats
    case limits

    var id: String { rawValue }

    var shortName: String {
        switch self {
        case .stats: "Stats"
        case .limits: "Limits"
        }
    }
}

/// The Usage tab: Stats (left) for cross-agent tokens and API-equivalent cost, and Limits (right)
/// for each signed-in subscription plan's live quota windows.
struct UsageScreen: View {
    @Environment(AppModel.self) private var model
    @State private var tab: UsageSectionTab = .stats

    private var isReading: Bool {
        tab == .stats ? model.stats.isReading : model.usage.isReading
    }

    private var readyMachineIds: [String] {
        model.machines.filter(\.summary.isReady).map(\.id)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    Picker("Section", selection: $tab) {
                        ForEach(UsageSectionTab.allCases) { item in
                            Text(item.shortName).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)

                    if tab == .stats {
                        StatsTabView()
                    } else {
                        limitsContent
                    }
                }
                .padding(.horizontal, Spacing.l)
                .padding(.top, Spacing.s)
                .padding(.bottom, Spacing.xxl)
            }
            .background(Palette.screen)
            .navigationTitle("Usage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(removing: .title)
            .pullToRefresh {
                if tab == .stats {
                    await model.stats.refresh(from: model.machines, force: true)
                } else {
                    await model.usage.refresh(from: model.machines, force: true)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text("Usage")
                        .font(.title3.weight(.bold))
                        .fixedSize()
                        .accessibilityAddTraits(.isHeader)
                }
                .sharedBackgroundVisibility(.hidden)
                if isReading {
                    ToolbarItem(placement: .primaryAction) { LoadingOrb(state: .working, label: "Reading usage") }
                }
            }
            .task(id: readyMachineIds) {
                guard !readyMachineIds.isEmpty else { return }
                await model.stats.refresh(from: model.machines)
                await model.usage.refresh(from: model.machines)
            }
            .onChange(of: tab) { _, next in
                Task {
                    if next == .stats {
                        await model.stats.refresh(from: model.machines)
                    } else {
                        await model.usage.refresh(from: model.machines)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var limitsContent: some View {
        if let report = model.usage.report, !report.plans.isEmpty {
            TimelineView(.everyMinute) { context in
                LazyVStack(alignment: .leading, spacing: Spacing.xxl) {
                    ForEach(report.plans) { plan in
                        PlanSection(report: plan, now: context.date, showsMachine: model.machines.count > 1)
                    }
                }
            }
        } else {
            ContentUnavailableView {
                Label("No plans yet", systemImage: "gauge.with.needle")
            } description: {
                Text(emptyDescription)
            }
            .padding(.top, Spacing.xxl)
        }
    }

    private var emptyDescription: String {
        if !model.machines.contains(where: \.summary.isReady) {
            return "Your Mac reads your plans once it's connected."
        }
        return "Sign in to your coding agents on your Mac, then pull to refresh."
    }
}

/// One plan: its mark, name and tier, when it was read, why the last read failed if it did, then
/// its limits.
private struct PlanSection: View {
    let report: PlanReport
    let now: Date
    let showsMachine: Bool

    private var detail: String? {
        let parts = [report.tier, showsMachine ? report.machineName : nil].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            header
            if let problem = report.problem {
                Label(problem, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(Palette.caution)
                    .padding(.horizontal, Spacing.xs)
            }
            ForEach(report.orderedWindows) { window in
                LimitCard(plan: report.plan, window: window, now: now)
            }
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.s) {
            PlanGlyph(plan: report.plan, name: report.name, size: 20)
            Text(report.name)
                .font(.title3.weight(.semibold))
            if let detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: Spacing.s)
            if let readAt = report.readAt {
                RelativeTime(date: readAt)
                    .font(.footnote)
                    .foregroundStyle(report.isStale(at: now) ? AnyShapeStyle(Palette.caution) : AnyShapeStyle(.tertiary))
            }
        }
        .padding(.horizontal, Spacing.xs)
        .accessibilityElement(children: .combine)
    }
}
