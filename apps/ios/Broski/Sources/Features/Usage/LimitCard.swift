import SwiftUI

/// One limit: what it covers, when it runs out if it will before it resets, how much is left as the
/// figure to read, the bar of what is left, and when it starts over.
struct LimitCard: View {
    let plan: UsagePlan
    let window: LimitWindow
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(alignment: .firstTextBaseline) {
                Text(window.title)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Spacer(minLength: Spacing.s)
                if let runsOut = window.runsOutWords(at: now) {
                    Text(runsOut).font(.footnote.weight(.medium)).lineLimit(1)
                }
            }
            .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                Text(window.leftPercent(at: now))
                    .font(.system(size: 40, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text("left")
                    .font(.body.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            UsageBar(plan: plan, window: window, now: now)
                .padding(.vertical, Spacing.xxs)
            Text(window.resetWords(at: now))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(Spacing.l + Spacing.xxs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.card, in: .rect(cornerRadius: Radius.sheetCard, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
