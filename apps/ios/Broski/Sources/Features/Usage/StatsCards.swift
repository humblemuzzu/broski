import BroskiCore
import SwiftUI

/// A titled group of the Stats tab, as Limits titles its plans: the title over one card.
struct StatsSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text(title)
                .font(.title3.weight(.semibold))
                .padding(.horizontal, Spacing.xs)
            VStack(alignment: .leading, spacing: Spacing.l) { content }
                .padding(Spacing.l + Spacing.xxs)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.card, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
        }
    }
}

/// One whole split into its parts, side by side in their colours.
struct ShareBar: View {
    struct Part: Identifiable {
        let id: String
        let value: Double
        let style: AnyShapeStyle
    }

    let parts: [Part]

    var body: some View {
        let shown = parts.filter { $0.value > 0 }
        let total = shown.reduce(0) { $0 + $1.value }
        GeometryReader { proxy in
            let usable = proxy.size.width - CGFloat(max(0, shown.count - 1)) * 2
            HStack(spacing: 2) {
                ForEach(shown) { part in
                    Rectangle()
                        .fill(part.style)
                        .frame(width: max(2, usable * part.value / max(total, .leastNonzeroMagnitude)))
                }
            }
        }
        .frame(height: 8)
        .clipShape(.capsule)
        .accessibilityHidden(true)
    }
}

/// How much of the largest a row is, as the Limits bars draw what is left.
private struct Meter: View {
    let fraction: Double
    let tint: Color

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.primary.opacity(0.08))
                Capsule()
                    .fill(tint.opacity(0.6))
                    .frame(width: max(4, proxy.size.width * min(1, fraction)))
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}

/// Each agent's part of the period: its share in one bar, then a row each. A row narrows the whole
/// tab to that agent and, narrowed, widens it again, as All agents under it does.
struct StatsAgentsCard: View {
    let summary: StatsSummary
    let metric: StatsMetric
    let isNarrowed: Bool
    let toggle: (StatsHarness) -> Void
    let widen: () -> Void

    private func value(_ entry: StatsHarnessEntry) -> Double {
        metric == .cost ? entry.costUsd : Double(entry.tokens.total)
    }

    private var total: Double {
        metric == .cost ? summary.totals.cost.total : Double(summary.totals.tokens.total)
    }

    var body: some View {
        StatsSection(title: "Agents") {
            if summary.harnesses.count > 1 {
                ShareBar(parts: summary.harnesses.map { .init(id: $0.displayName, value: value($0), style: AnyShapeStyle($0.harness.tint)) })
            }
            VStack(spacing: Spacing.m) {
                ForEach(summary.harnesses, id: \.harness) { entry in
                    Button { toggle(entry.harness) } label: { row(entry) }
                        .buttonStyle(.plain)
                }
                if isNarrowed {
                    Button("All agents", action: widen)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, Spacing.xxs)
                }
            }
        }
    }

    private func row(_ entry: StatsHarnessEntry) -> some View {
        HStack(spacing: Spacing.s) {
            Circle().fill(entry.harness.tint).frame(width: 8, height: 8)
            Text(entry.displayName).lineLimit(1)
            Spacer(minLength: Spacing.s)
            Text(metric == .cost ? StatsFormat.usd(entry.costUsd) : StatsFormat.tokens(entry.tokens.total))
                .fontWeight(.semibold)
                .monospacedDigit()
            Text(StatsFormat.percent(total > 0 ? value(entry) / total : 0))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .frame(minWidth: 44, alignment: .trailing)
        }
        .frame(minHeight: 28)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
        .accessibilityHint(isNarrowed ? "Shows every agent" : "Shows only \(entry.displayName)")
    }
}

/// What the period went to: its models, its projects or its sub-agents, the largest five with a bar
/// each against the first, the rest a tap away.
struct StatsTopCard: View {
    let summary: StatsSummary
    let metric: StatsMetric
    @State private var kind: Kind = .models
    @State private var showsAll = false

    enum Kind: String, CaseIterable, Identifiable {
        case models = "Models"
        case projects = "Projects"
        case subagents = "Sub-agents"
        var id: Self { self }
    }

    struct Item: Identifiable {
        let id: String
        let name: String
        let costUsd: Double
        let tokens: Int64
        /// What else is known of it: "6,100 turns", "180 sessions".
        let count: String
        let tint: Color
    }

    static let shown = 5

    private var kinds: [Kind] {
        Kind.allCases.filter { !items($0).isEmpty }
    }

    private var current: Kind { kinds.contains(kind) ? kind : kinds.first ?? .models }

    var body: some View {
        if !kinds.isEmpty {
            StatsSection(title: "Top") {
                if kinds.count > 1 {
                    Picker("Show", selection: $kind) {
                        ForEach(kinds) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                let all = items(current)
                let peak = all.first.map(value) ?? 0
                VStack(spacing: Spacing.l) {
                    ForEach(showsAll ? all : Array(all.prefix(Self.shown))) { item in
                        row(item, fraction: peak > 0 ? value(item) / peak : 0)
                    }
                }
                if all.count > Self.shown {
                    Button(showsAll ? "Show fewer" : "Show all \(all.count)") {
                        withAnimation(.snappy(duration: 0.25)) { showsAll.toggle() }
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                }
            }
            .onChange(of: kind) { showsAll = false }
        }
    }

    private func value(_ item: Item) -> Double {
        metric == .cost ? item.costUsd : Double(item.tokens)
    }

    private func row(_ item: Item, fraction: Double) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                Text(item.name)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: Spacing.s)
                Text(metric == .cost ? StatsFormat.usd(item.costUsd) : StatsFormat.tokens(item.tokens))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            Meter(fraction: fraction, tint: item.tint)
            Text(detail(item))
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    /// The measure not shown on the right, then the count: "28.0B tokens · 6,100 turns" beside a cost.
    private func detail(_ item: Item) -> String {
        let other = metric == .cost ? "\(StatsFormat.tokens(item.tokens)) tokens" : StatsFormat.usd(item.costUsd)
        return "\(other) · \(item.count)"
    }

    private func items(_ kind: Kind) -> [Item] {
        let items: [Item] = switch kind {
        case .models:
            summary.models.map {
                Item(
                    id: "\($0.provider)/\($0.model)", name: $0.model, costUsd: $0.cost.total, tokens: $0.tokens.total,
                    count: "\($0.turns.formatted()) \($0.turns == 1 ? "turn" : "turns")",
                    tint: $0.harnesses.first?.tint ?? .secondary)
            }
        case .projects:
            summary.projects.map {
                Item(
                    id: $0.id, name: $0.name, costUsd: $0.costUsd, tokens: $0.totalTokens,
                    count: "\($0.sessions.formatted()) \($0.sessions == 1 ? "session" : "sessions")",
                    tint: $0.harnesses.first?.tint ?? .secondary)
            }
        case .subagents:
            summary.subagents.map {
                Item(
                    id: $0.name, name: $0.name, costUsd: $0.costUsd, tokens: $0.totalTokens,
                    count: "\($0.runs.formatted()) \($0.runs == 1 ? "run" : "runs")" + ($0.failures > 0 ? " · \($0.failures) failed" : ""),
                    tint: $0.harnesses.first?.tint ?? .secondary)
            }
        }
        return items.filter { value($0) > 0 }.sorted { value($0) > value($1) }
    }
}

/// Where the tokens or the money went by kind, in shades of one ink: cache reads, cache writes, fresh
/// input and output. Then what the cache did: how much of the input it served and what it saved.
struct StatsTypesCard: View {
    let totals: StatsTotals
    let metric: StatsMetric

    private struct Kind: Identifiable {
        let id: String
        let value: Double
        let shade: Double
    }

    private var kinds: [Kind] {
        let tokens = totals.tokens, cost = totals.cost
        return metric == .cost
            ? [
                Kind(id: "Cache read", value: cost.cacheRead, shade: 0.22),
                Kind(id: "Cache write", value: cost.cacheWrite, shade: 0.42),
                Kind(id: "Input", value: cost.input, shade: 0.64),
                Kind(id: "Output", value: cost.output, shade: 0.9),
            ]
            : [
                Kind(id: "Cache read", value: Double(tokens.cachedInput), shade: 0.22),
                Kind(id: "Cache write", value: Double(tokens.cacheCreation), shade: 0.42),
                Kind(id: "Input", value: Double(tokens.uncachedInput), shade: 0.64),
                Kind(id: "Output", value: Double(tokens.output), shade: 0.9),
            ]
    }

    var body: some View {
        let kinds = kinds
        let total = kinds.reduce(0) { $0 + $1.value }
        if total > 0 {
            StatsSection(title: "By type") {
                ShareBar(parts: kinds.map { .init(id: $0.id, value: $0.value, style: AnyShapeStyle(.primary.opacity($0.shade))) })
                VStack(spacing: Spacing.m) {
                    ForEach(kinds) { kind in
                        HStack(spacing: Spacing.s) {
                            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                .fill(.primary.opacity(kind.shade))
                                .frame(width: 10, height: 10)
                            Text(kind.id).font(.subheadline)
                            Spacer(minLength: Spacing.s)
                            Text(metric == .cost ? StatsFormat.usd(kind.value) : StatsFormat.tokens(Int64(kind.value)))
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                            Text(StatsFormat.percent(kind.value / total))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                                .frame(minWidth: 44, alignment: .trailing)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                if !figures.isEmpty {
                    Divider()
                    HStack(alignment: .top, spacing: Spacing.l) {
                        ForEach(figures, id: \.caption) { figure in
                            VStack(alignment: .leading, spacing: Spacing.xxs) {
                                Text(figure.value)
                                    .font(.system(.title3, design: .rounded).weight(.semibold))
                                    .monospacedDigit()
                                Text(figure.caption)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
        }
    }

    private var figures: [(value: String, caption: String)] {
        var figures: [(value: String, caption: String)] = []
        if let hit = totals.tokens.cacheHitRate { figures.append((StatsFormat.percent(hit), "Cache hit")) }
        if totals.cacheSavingsUsd > 0 { figures.append((StatsFormat.usd(totals.cacheSavingsUsd), "Saved by cache")) }
        if totals.tokens.reasoning > 0 { figures.append((StatsFormat.tokens(totals.tokens.reasoning), "Reasoning")) }
        if totals.speedCost.premium > 0 { figures.append(("+" + StatsFormat.usd(totals.speedCost.premium), "Fast mode")) }
        return Array(figures.prefix(3))
    }
}
