import SwiftUI
import WidgetKit

/// A small uppercase label above or beside a figure.
struct Eyebrow: View {
    let text: String
    var style: HierarchicalShapeStyle = .secondary

    init(_ text: String, style: HierarchicalShapeStyle = .secondary) {
        self.text = text
        self.style = style
    }

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.7)
            .foregroundStyle(style)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }
}

/// The share used as the figure a glance reads: tight numerals, a smaller quieter percent sign.
struct HeroPercent: View {
    let used: Double
    var size: CGFloat = 40
    var color: Color = .primary

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text("\(Int((used * 100).rounded()))")
                .font(.system(size: size, weight: .semibold))
                .foregroundStyle(color)
                .tracking(-size * 0.04)
                .monospacedDigit()
                .contentTransition(.numericText())
            Text("%")
                .font(.system(size: size * 0.46, weight: .semibold))
                .foregroundStyle(.secondary)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .widgetAccentable()
    }
}

/// Where use stands against an even spread: under, on or over pace, or when it would run out.
struct PaceBadge: View {
    let plan: UsagePlan
    let pace: LimitWindow.Pace
    let span: LimitSpan
    /// Inline in a line of text, without its capsule.
    var plain = false

    var body: some View {
        let label = Label {
            Text(title)
        } icon: {
            Image(systemName: symbol)
        }
        .labelStyle(.titleAndIcon)
        .foregroundStyle(tint)
        .lineLimit(1)
        .fixedSize()
        if plain {
            label
        } else {
            label
                .font(.system(size: 10.5, weight: .semibold))
                .padding(.horizontal, 7)
                .padding(.vertical, 3.5)
                .background(tint.opacity(0.13), in: .capsule)
        }
    }

    private var title: String {
        switch pace {
        case .under: "Under pace"
        case .steady: "On pace"
        case .over: "Over pace"
        case .runsOut(let date):
            "Out \(date.formatted(span == .week ? .dateTime.weekday(.abbreviated) : .dateTime.hour().minute()))"
        }
    }

    private var symbol: String {
        switch pace {
        case .under: "arrow.down.right"
        case .steady: "equal"
        case .over: "arrow.up.right"
        case .runsOut: "exclamationmark.triangle.fill"
        }
    }

    private var tint: Color {
        switch pace {
        case .under, .steady: plan.tint
        case .over: LimitWindow.Severity.high.tint(for: plan)
        case .runsOut: LimitWindow.Severity.critical.tint(for: plan)
        }
    }
}

/// "38%", the share of a window used.
struct UsedPercent: View {
    let window: LimitWindow?
    let now: Date

    var body: some View {
        Text(window.map { "\(Int(($0.used(at: now) * 100).rounded()))%" } ?? "–")
            .monospacedDigit()
            .contentTransition(.numericText())
    }
}

/// When a window starts over: a countdown that keeps itself current within a day, the weekday and
/// time beyond it.
struct ResetText: View {
    let window: LimitWindow
    let now: Date
    var prefix = "Resets"

    var body: some View {
        if let resetsAt = window.resetsAt, resetsAt > now {
            if resetsAt.timeIntervalSince(now) < 20 * 3600 {
                Text("\(prefix) in \(Text(resetsAt, style: .relative))")
            } else {
                Text("\(prefix) \(resetsAt, format: .dateTime.weekday(.abbreviated).hour().minute())")
            }
        } else {
            Text(window.used(at: now) == 0 ? "Not started" : "Started over")
        }
    }
}
