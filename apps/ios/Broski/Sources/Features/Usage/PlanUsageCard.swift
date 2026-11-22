import SwiftUI

/// One plan: its mark, tier and Mac, why the last read failed if it did, its fullest window as a
/// figure over its burn chart, then every other window with its reset and where its pace leads.
struct PlanUsageCard: View {
    let report: PlanReport
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            header
            if let problem = report.problem {
                Banner(style: .warning, message: problem)
            }
            if let window = report.headline(at: now) {
                headline(window)
                let others = report.windows.filter { $0.id != window.id }.sorted { $0.used(at: now) > $1.used(at: now) }
                if !others.isEmpty {
                    Rectangle().fill(.primary.opacity(0.08)).frame(height: 0.5)
                    VStack(spacing: Spacing.l) {
                        ForEach(others) { other in
                            LimitRow(plan: report.plan, window: other, now: now)
                        }
                    }
                }
            }
        }
        .padding(Spacing.l + Spacing.xs)
        .background {
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .fill(Palette.card)
                .overlay {
                    LinearGradient(colors: [report.plan.tint.opacity(0.10), .clear], startPoint: .top, endPoint: .center)
                        .clipShape(.rect(cornerRadius: Radius.card, style: .continuous))
                        .allowsHitTesting(false)
                }
        }
    }

    private var header: some View {
        HStack(spacing: Spacing.m) {
            PlanGlyph(plan: report.plan, name: report.name, size: 22)
                .frame(width: 40, height: 40)
                .background(report.plan.tint.opacity(0.12), in: .rect(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(report.name).font(.headline)
                Text([report.tier, report.machineName].compactMap(\.self).joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if let readAt = report.readAt {
                RelativeTime(date: readAt)
                    .font(.footnote)
                    .foregroundStyle(report.isStale(at: now) ? Palette.caution : .secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Enough readings across the window for its line to say more than the meter.
    private func charts(_ window: LimitWindow) -> Bool {
        window.trace(at: now).count >= 8
    }

    private func headline(_ window: LimitWindow) -> some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Eyebrow(window.shortScope.map { "\(window.span.title) · \($0)" } ?? "\(window.span.title) limit")
                    HeroPercent(used: window.used(at: now), size: 56, color: report.plan.bright)
                }
                Spacer(minLength: Spacing.s)
                if let pace = window.pace(at: now) {
                    PaceBadge(plan: report.plan, pace: pace, span: window.span)
                }
            }
            TickMeter(plan: report.plan, window: window, now: now, height: 34, showsScale: true)
            TimeTrack(plan: report.plan, window: window, now: now)
            if charts(window) {
                BurnChart(plan: report.plan, window: window, now: now, style: .axes)
                    .frame(height: 150)
                ChartLegend(plan: report.plan, window: window, now: now)
            }
        }
    }
}

/// What each line of the chart is.
private struct ChartLegend: View {
    let plan: UsagePlan
    let window: LimitWindow
    let now: Date

    var body: some View {
        let tint = window.severity(at: now).tint(for: plan)
        HStack(spacing: Spacing.l) {
            key("Used", stroke: StrokeStyle(lineWidth: 2.25, lineCap: .round), color: tint)
            key("Even pace", stroke: StrokeStyle(lineWidth: 1, dash: [2, 3]), color: .secondary)
            if window.pace(at: now) != nil {
                key("At this pace", stroke: StrokeStyle(lineWidth: 1.25, dash: [3, 3]), color: tint.opacity(0.7))
            }
        }
        .font(.caption2.weight(.medium))
        .foregroundStyle(.secondary)
    }

    private func key(_ title: String, stroke: StrokeStyle, color: Color) -> some View {
        HStack(spacing: Spacing.xs) {
            Path { path in
                path.move(to: CGPoint(x: 0, y: 3))
                path.addLine(to: CGPoint(x: 14, y: 3))
            }
            .stroke(color, style: stroke)
            .frame(width: 14, height: 6)
            Text(title)
        }
    }
}

/// One window: what it covers, how much is used, its bar, when it resets, and when it runs out if
/// the pace so far would empty it first.
private struct LimitRow: View {
    let plan: UsagePlan
    let window: LimitWindow
    let now: Date

    var body: some View {
        let severity = window.severity(at: now)
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(alignment: .firstTextBaseline) {
                Text(window.title).font(.subheadline.weight(.semibold))
                Spacer()
                UsedPercent(window: window, now: now)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(severity == .normal ? .primary : severity.tint(for: plan))
            }
            TickMeter(plan: plan, window: window, now: now, height: 16)
            HStack(spacing: Spacing.xs) {
                ResetText(window: window, now: now)
                if let out = window.runsOut(at: now) {
                    Text("· runs out \(out, format: .dateTime.weekday(.abbreviated).hour().minute()) at this pace")
                        .foregroundStyle(Palette.caution)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .lineLimit(2)
        }
        .accessibilityElement(children: .combine)
    }
}
