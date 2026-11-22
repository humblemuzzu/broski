import BroskiCore
import SwiftUI

private enum StatsBreakdownMode: String, CaseIterable, Identifiable {
    case models
    case time
    case projects
    case agents

    var id: String { rawValue }

    var shortName: String {
        switch self {
        case .models: "Models"
        case .time: "Time"
        case .projects: "Projects"
        case .agents: "Agents"
        }
    }
}

struct StatsTabView: View {
    @Environment(AppModel.self) private var model
    @State private var breakdown: StatsBreakdownMode = .models

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            controlsRow
            if let summary = model.stats.summary {
                heroCard(summary)
                StatsActivityChart(
                    series: summary.series,
                    resolution: summary.resolution,
                    metric: model.stats.metric
                )
                totalsCard(summary.totals)
                shareBars(summary)
                breakdownCard(summary)
            } else if model.stats.isReading {
                ProgressView("Scanning agent history…")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xxxl)
            } else {
                ContentUnavailableView {
                    Label("No stats yet", systemImage: "chart.bar.xaxis")
                } description: {
                    Text(emptyNote)
                }
                .padding(.top, Spacing.xxl)
            }
        }
    }

    private var emptyNote: String {
        if !model.machines.contains(where: \.summary.isReady) {
            return "Your Mac scans local agent history once connected."
        }
        return "Pull to refresh to scan local Claude Code, Pi, Codex, OpenCode, Antigravity, Grok, and Gemini logs."
    }

    private var controlsRow: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(spacing: Spacing.s) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Spacing.xs) {
                        ForEach(StatsRange.ordered, id: \.self) { option in
                            let selected = model.stats.range == option
                            Button {
                                Task { await model.stats.selectRange(option, machines: model.machines) }
                            } label: {
                                Text(option.shortName)
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(
                                        selected ? Palette.accent : Palette.card,
                                        in: Capsule()
                                    )
                                    .foregroundStyle(selected ? Palette.onAccent : .primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                Picker("Metric", selection: Binding(
                    get: { model.stats.metric },
                    set: { model.stats.metric = $0 }
                )) {
                    ForEach(StatsMetric.allCases) { item in
                        Text(item.shortName).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 126)
            }

            if let activeHarness = model.stats.selectedHarness {
                Button {
                    Task { await model.stats.clearHarness(machines: model.machines) }
                } label: {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(activeHarness.tint)
                            .frame(width: 7, height: 7)
                        Text(activeHarness.displayName)
                            .font(.caption.weight(.medium))
                        Image(systemName: "xmark")
                            .font(.caption2.weight(.semibold))
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Palette.card, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func heroCard(_ stats: StatsSummary) -> some View {
        let metric = model.stats.metric
        let primaryText = metric == .cost
            ? StatsFormat.usd(stats.totals.cost.total)
            : StatsFormat.tokens(stats.totals.tokens.total)
        let deltaText: String? = {
            guard let prev = stats.previousTotals else { return nil }
            return metric == .cost
                ? StatsFormat.delta(current: stats.totals.cost.total, previous: prev.cost.total)
                : StatsFormat.delta(current: Double(stats.totals.tokens.total), previous: Double(prev.tokens.total))
        }()
        let sessionWord = stats.totals.sessions == 1 ? "session" : "sessions"

        return VStack(alignment: .leading, spacing: Spacing.m) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                    Text(primaryText)
                        .font(.system(size: 38, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                    if let deltaText {
                        Text(deltaText)
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(.quaternary.opacity(0.6), in: Capsule())
                    }
                    Spacer(minLength: 0)
                    if stats.scanState != .fresh {
                        ProgressView()
                            .controlSize(.mini)
                    }
                }

                HStack(spacing: 6) {
                    let metaLine = metric == .cost
                        ? "\(stats.totals.sessions) \(sessionWord) · \(StatsFormat.costSourceCaption(stats.totals.costSource))"
                        : "\(stats.totals.sessions) \(sessionWord) · \(stats.totals.turns) turns"
                    Text(metaLine)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    if metric == .cost && stats.totals.unpricedTurns > 0 {
                        Text("(\(stats.totals.unpricedTurns) unpriced)")
                            .font(.caption)
                            .foregroundStyle(Palette.caution)
                    }
                }
            }

            if !stats.harnesses.isEmpty {
                Divider()
                VStack(spacing: Spacing.m) {
                    ForEach(stats.harnesses, id: \.harness) { entry in
                        harnessRow(entry, totals: stats.totals, metric: metric)
                    }
                }
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
    }

    private func harnessRow(_ entry: StatsHarnessEntry, totals: StatsTotals, metric: StatsMetric) -> some View {
        let share = metric == .cost
            ? (totals.cost.total > 0 ? entry.costUsd / totals.cost.total : 0)
            : (totals.tokens.total > 0 ? Double(entry.tokens.total) / Double(totals.tokens.total) : 0)
        let primaryValue = metric == .cost ? StatsFormat.usd(entry.costUsd) : StatsFormat.tokens(entry.tokens.total)
        let subLine = metric == .cost
            ? "\(StatsFormat.percent(share)) of cost · \(StatsFormat.tokens(entry.tokens.total)) tokens"
            : "\(StatsFormat.percent(share)) of tokens · \(StatsFormat.usd(entry.costUsd))"
        let selected = model.stats.selectedHarness == entry.harness

        return Button {
            Task { await model.stats.toggleHarness(entry.harness, machines: model.machines) }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.s) {
                    Circle()
                        .fill(entry.harness.tint)
                        .frame(width: 8, height: 8)
                    Text(entry.displayName)
                        .font(.subheadline.weight(selected ? .semibold : .medium))
                        .foregroundStyle(.primary)
                    Text("\(entry.sessions) \(entry.sessions == 1 ? "session" : "sessions")")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .monospacedDigit()
                    Spacer(minLength: Spacing.s)
                    Text(primaryValue)
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                }
                Text(subLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .padding(.leading, 16)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func totalsCard(_ totals: StatsTotals) -> some View {
        let cacheHitText = totals.tokens.cacheHitRate.map(StatsFormat.percent) ?? "—"
        let columns = [GridItem(.flexible(), spacing: Spacing.m), GridItem(.flexible(), spacing: Spacing.m)]
        return VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Totals")
                .font(.subheadline.weight(.semibold))
            LazyVGrid(columns: columns, alignment: .leading, spacing: Spacing.m) {
                metricCell("Processed tokens", StatsFormat.tokens(totals.tokens.total))
                metricCell("Cached input", StatsFormat.tokens(totals.tokens.cachedInput))
                metricCell("Uncached input", StatsFormat.tokens(totals.tokens.uncachedInput))
                metricCell("Output", StatsFormat.tokens(totals.tokens.output))
                metricCell("Cache savings", StatsFormat.usd(totals.cacheSavingsUsd))
                metricCell(
                    "Cache hit",
                    totals.busts > 0 ? "\(cacheHitText) · \(totals.busts) busts" : cacheHitText
                )
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
    }

    private func metricCell(_ heading: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(heading)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func shareBars(_ stats: StatsSummary) -> some View {
        if stats.totals.tokens.total > 0 {
            if model.stats.metric == .tokens {
                StatsShareBarCard(
                    heading: "Tokens by type",
                    aside: stats.totals.tokens.reasoning > 0
                        ? "\(StatsFormat.tokens(stats.totals.tokens.reasoning)) reasoning"
                        : nil,
                    segments: [
                        ShareSegment(id: "cacheRead", caption: "Cache read", value: Double(stats.totals.tokens.cachedInput), tint: .mint),
                        ShareSegment(id: "cacheWrite", caption: "Cache write", value: Double(stats.totals.tokens.cacheCreation), tint: .orange),
                        ShareSegment(id: "input", caption: "Uncached input", value: Double(stats.totals.tokens.uncachedInput), tint: .blue),
                        ShareSegment(id: "output", caption: "Output", value: Double(stats.totals.tokens.output), tint: .purple),
                    ],
                    formatValue: { StatsFormat.tokens(Int64($0)) }
                )
            } else {
                StatsShareBarCard(
                    heading: "Cost by type",
                    aside: nil,
                    segments: [
                        ShareSegment(id: "input", caption: "Uncached input", value: stats.totals.cost.input, tint: .blue),
                        ShareSegment(id: "output", caption: "Output", value: stats.totals.cost.output, tint: .purple),
                        ShareSegment(id: "cacheRead", caption: "Cache read", value: stats.totals.cost.cacheRead, tint: .mint),
                        ShareSegment(id: "cacheWrite", caption: "Cache write", value: stats.totals.cost.cacheWrite, tint: .orange),
                    ],
                    formatValue: StatsFormat.usd
                )
                if stats.totals.speedCost.fast + stats.totals.speedCost.ultrafast > 0 {
                    StatsShareBarCard(
                        heading: "Cost by speed",
                        aside: stats.totals.speedCost.premium > 0
                            ? "+\(StatsFormat.usd(stats.totals.speedCost.premium)) premium"
                            : nil,
                        segments: [
                            ShareSegment(id: "std", caption: "Standard", value: stats.totals.speedCost.standard, tint: .blue),
                            ShareSegment(id: "fast", caption: "Fast", value: stats.totals.speedCost.fast, tint: .orange),
                            ShareSegment(id: "ultra", caption: "Ultrafast", value: stats.totals.speedCost.ultrafast, tint: .red),
                        ],
                        formatValue: StatsFormat.usd
                    )
                }
            }
        }
    }

    private func breakdownCard(_ stats: StatsSummary) -> some View {
        let modes: [StatsBreakdownMode] = stats.subagents.isEmpty
            ? [.models, .time, .projects]
            : [.models, .time, .projects, .agents]
        let activeMode = modes.contains(breakdown) ? breakdown : .models

        return VStack(alignment: .leading, spacing: Spacing.m) {
            HStack {
                Text("Breakdown")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Picker("Breakdown", selection: Binding(
                    get: { activeMode },
                    set: { breakdown = $0 }
                )) {
                    ForEach(modes) { mode in
                        Text(mode == .time && stats.resolution == .hour ? "Hours" : mode.shortName).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 230)
            }

            switch activeMode {
            case .models:
                modelsList(stats)
            case .time:
                timeList(stats)
            case .projects:
                projectsList(stats)
            case .agents:
                subagentsList(stats)
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
    }

    @ViewBuilder
    private func modelsList(_ stats: StatsSummary) -> some View {
        let metric = model.stats.metric
        let sorted = metric == .tokens
            ? stats.models.sorted { $0.tokens.total > $1.tokens.total }
            : stats.models
        let peak = sorted.map { metric == .tokens ? Double($0.tokens.total) : $0.cost.total }.max() ?? 0
        if sorted.isEmpty {
            Text("No model activity in this window.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            VStack(spacing: Spacing.m) {
                ForEach(Array(sorted.prefix(15).enumerated()), id: \.offset) { idx, item in
                    let val = metric == .tokens ? Double(item.tokens.total) : item.cost.total
                    let share = metric == .tokens
                        ? (stats.totals.tokens.total > 0 ? Double(item.tokens.total) / Double(stats.totals.tokens.total) : 0)
                        : (stats.totals.cost.total > 0 ? item.cost.total / stats.totals.cost.total : 0)
                    let tint = item.harnesses.first?.tint ?? .blue
                    let sub = "\(StatsFormat.percent(share)) · \(StatsFormat.tokens(item.tokens.total)) tokens · \(item.turns) turns"
                    breakdownBarRow(
                        rank: idx + 1,
                        name: item.model,
                        valueText: metric == .tokens ? StatsFormat.tokens(item.tokens.total) : StatsFormat.usd(item.cost.total),
                        subText: sub,
                        fraction: peak > 0 ? val / peak : 0,
                        tint: tint
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func timeList(_ stats: StatsSummary) -> some View {
        let metric = model.stats.metric
        let active = stats.series.reversed().filter { metric == .tokens ? $0.totalTokens > 0 : $0.costUsd > 0 }
        let peak = active.map { metric == .tokens ? Double($0.totalTokens) : $0.costUsd }.max() ?? 0
        if active.isEmpty {
            Text("No activity in this window.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            VStack(spacing: Spacing.m) {
                ForEach(Array(active.prefix(20).enumerated()), id: \.offset) { idx, pt in
                    let val = metric == .tokens ? Double(pt.totalTokens) : pt.costUsd
                    let hitText = pt.cacheDenom > 0
                        ? " · \(StatsFormat.percent(Double(pt.cacheRead) / Double(pt.cacheDenom))) cache"
                        : ""
                    let rowName = pt.label
                    breakdownBarRow(
                        rank: idx + 1,
                        name: rowName,
                        valueText: metric == .tokens ? StatsFormat.tokens(pt.totalTokens) : StatsFormat.usd(pt.costUsd),
                        subText: "\(StatsFormat.tokens(pt.totalTokens)) tokens · \(pt.turns) turns\(hitText)",
                        fraction: peak > 0 ? val / peak : 0,
                        tint: pt.byHarness.max(by: { $0.costUsd < $1.costUsd })?.harness.tint ?? .blue
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func projectsList(_ stats: StatsSummary) -> some View {
        let metric = model.stats.metric
        let sorted = metric == .tokens
            ? stats.projects.sorted { $0.totalTokens > $1.totalTokens }
            : stats.projects
        let peak = sorted.map { metric == .tokens ? Double($0.totalTokens) : $0.costUsd }.max() ?? 0
        if sorted.isEmpty {
            Text("No project activity in this window.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            VStack(spacing: Spacing.m) {
                ForEach(Array(sorted.prefix(15).enumerated()), id: \.offset) { idx, proj in
                    let val = metric == .tokens ? Double(proj.totalTokens) : proj.costUsd
                    breakdownBarRow(
                        rank: idx + 1,
                        name: proj.name,
                        valueText: metric == .tokens ? StatsFormat.tokens(proj.totalTokens) : StatsFormat.usd(proj.costUsd),
                        subText: "\(proj.sessions) \(proj.sessions == 1 ? "session" : "sessions") · \(StatsFormat.tokens(proj.totalTokens)) tokens",
                        fraction: peak > 0 ? val / peak : 0,
                        tint: proj.harnesses.first?.tint ?? .blue
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func subagentsList(_ stats: StatsSummary) -> some View {
        let metric = model.stats.metric
        let peak = stats.subagents.map { metric == .tokens ? Double($0.totalTokens) : $0.costUsd }.max() ?? 0
        if stats.subagents.isEmpty {
            Text("No sub-agent runs in this window.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else {
            VStack(spacing: Spacing.m) {
                ForEach(Array(stats.subagents.prefix(15).enumerated()), id: \.offset) { idx, ag in
                    let val = metric == .tokens ? Double(ag.totalTokens) : ag.costUsd
                    let failPart = ag.failures > 0 ? " · \(ag.failures) failed" : ""
                    breakdownBarRow(
                        rank: idx + 1,
                        name: ag.name,
                        valueText: metric == .tokens ? StatsFormat.tokens(ag.totalTokens) : StatsFormat.usd(ag.costUsd),
                        subText: "\(ag.runs) runs · \(StatsFormat.tokens(ag.totalTokens)) tokens\(failPart)",
                        fraction: peak > 0 ? val / peak : 0,
                        tint: ag.harnesses.first?.tint ?? .purple
                    )
                }
            }
        }
    }

    private func breakdownBarRow(
        rank: Int,
        name: String,
        valueText: String,
        subText: String,
        fraction: Double,
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                Text("\(rank)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.tertiary)
                    .frame(width: 18, alignment: .leading)
                Text(name)
                    .font(.footnote.weight(.medium))
                    .lineLimit(1)
                Spacer(minLength: Spacing.s)
                Text(valueText)
                    .font(.footnote.weight(.semibold))
                    .monospacedDigit()
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.quaternary.opacity(0.45))
                    if fraction > 0 {
                        Capsule()
                            .fill(tint.opacity(0.75))
                            .frame(width: max(4, geo.size.width * min(1, fraction)))
                    }
                }
            }
            .frame(height: 5)
            .padding(.leading, 26)
            Text(subText)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .padding(.leading, 26)
        }
    }
}
