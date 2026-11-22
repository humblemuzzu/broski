import SwiftUI

/// A settings row: its symbol on a tile of its colour, the title, and the current value in grey
/// before the chevron its link adds.
struct SettingsRow: View {
    let title: String
    let symbol: String
    let tint: Color
    var value: String?

    var body: some View {
        HStack(spacing: Spacing.m) {
            SettingsIcon(symbol: symbol, tint: tint)
            Text(title)
            Spacer(minLength: Spacing.s)
            if let value {
                Text(value)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(value ?? "")
    }
}

/// A white symbol on a continuous-corner tile, as the system's Settings draws its rows.
struct SettingsIcon: View {
    let symbol: String
    let tint: Color
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 30

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: side * 0.5, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: side, height: side)
            .background(tint, in: .rect(cornerRadius: side * 0.26, style: .continuous))
            .accessibilityHidden(true)
    }
}
