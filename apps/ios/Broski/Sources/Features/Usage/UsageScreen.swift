import SwiftUI
import ThinkingOrbsKit

/// The Usage tab: each plan the Macs' agents run on, under its mark, with one card per limit. Pull
/// to read again.
struct UsageScreen: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            ScrollView {
                if let report = model.usage.report, !report.plans.isEmpty {
                    TimelineView(.everyMinute) { context in
                        LazyVStack(alignment: .leading, spacing: Spacing.xxl) {
                            ForEach(report.plans) { plan in
                                PlanSection(report: plan, now: context.date, showsMachine: model.machines.count > 1)
                            }
                        }
                        .padding(.horizontal, Spacing.l)
                        .padding(.top, Spacing.s)
                        .padding(.bottom, Spacing.xxl)
                    }
                } else {
                    ContentUnavailableView {
                        Label("No plans yet", systemImage: "gauge.with.needle")
                    } description: {
                        Text(emptyDescription)
                    }
                    .padding(.top, Spacing.xxxl * 2)
                }
            }
            .background(Palette.screen)
            .navigationTitle("Usage")
            .refreshable { await model.usage.refresh(from: model.machines, force: true) }
            .toolbar {
                if model.usage.isReading {
                    ToolbarItem(placement: .primaryAction) { LoadingOrb(state: .working, label: "Reading usage") }
                }
            }
            .task { await model.usage.refresh(from: model.machines) }
        }
    }

    private var emptyDescription: String {
        if !model.machines.contains(where: \.summary.isReady) {
            return "Your Mac reads your plans once it's connected."
        }
        return "Sign in to Claude Code or Antigravity on your Mac, then pull to refresh."
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
