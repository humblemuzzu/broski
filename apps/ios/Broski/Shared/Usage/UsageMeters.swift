import SwiftUI
import WidgetKit

/// A window's share as a row of ticks: lit up to what is used in the plan's gradient (warming as it
/// nears the limit), dim and shorter beyond, and one bright tick standing where an even pace would be.
struct TickMeter: View {
    let plan: UsagePlan
    let window: LimitWindow
    let now: Date
    var height: CGFloat = 22
    var showsScale = false

    var body: some View {
        VStack(spacing: 5) {
            if showsScale {
                HStack {
                    Text("0")
                    Spacer()
                    Text("50")
                    Spacer()
                    Text("100")
                }
                .font(.system(size: 9, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.tertiary)
            }
            TickRow(
                used: window.used(at: now), pace: window.elapsed(at: now),
                colors: plan.meterColors(window.severity(at: now)))
                .frame(height: height)
        }
        .widgetAccentable()
        .accessibilityElement()
        .accessibilityLabel("\(window.title): \(Int((window.used(at: now) * 100).rounded())) percent used")
    }
}

private struct TickRow: View {
    let used: Double
    let pace: Double?
    let colors: [Color]

    var body: some View {
        Canvas { context, size in
            let width = min(5, max(3, (size.height * 0.14).rounded(.toNearestOrAwayFromZero)))
            let gap = width
            let count = max(1, Int((size.width + gap) / (width + gap)))
            let step = (size.width - width) / CGFloat(max(1, count - 1))
            let lit = Int((used * Double(count)).rounded())
            let paceIndex = pace.map { min(count - 1, Int(($0 * Double(count)).rounded(.down))) }
            let tall = size.height - 6
            let short = tall * 0.55
            var filled = Path()
            var empty = Path()
            for index in 0..<count where index != paceIndex {
                let x = CGFloat(index) * step
                let tickHeight = index < lit ? tall : short
                let rect = CGRect(x: x, y: (size.height - tickHeight) / 2, width: width, height: tickHeight)
                let tick = Path(roundedRect: rect, cornerRadius: width / 2)
                if index < lit { filled.addPath(tick) } else { empty.addPath(tick) }
            }
            context.fill(empty, with: .color(.primary.opacity(0.16)))
            context.fill(
                filled,
                with: .linearGradient(
                    Gradient(colors: colors), startPoint: .zero, endPoint: CGPoint(x: size.width, y: 0)))
            if let paceIndex {
                let rect = CGRect(x: CGFloat(paceIndex) * step - 0.5, y: 0, width: width + 1, height: size.height)
                context.fill(Path(roundedRect: rect, cornerRadius: (width + 1) / 2), with: .color(.primary))
            }
        }
    }
}

/// A window's time as a journey, start to reset: the stretch travelled in the plan's colours, its mark
/// riding where now is, and below, when it began, how long is left, and when it resets.
struct TimeTrack: View {
    let plan: UsagePlan
    let window: LimitWindow
    let now: Date

    var body: some View {
        if let start = window.start, let resetsAt = window.resetsAt, resetsAt > now {
            let travelled = window.elapsed(at: now) ?? 0
            VStack(spacing: 6) {
                GeometryReader { proxy in
                    let x = proxy.size.width * travelled
                    ZStack(alignment: .leading) {
                        Capsule().fill(.primary.opacity(0.13)).frame(height: 4)
                        Capsule()
                            .fill(LinearGradient(colors: plan.meterColors(.normal).map { $0.opacity(0.85) }, startPoint: .leading, endPoint: .trailing))
                            .frame(width: max(4, x), height: 4)
                        PlanGlyph(plan: plan, size: 11)
                            .frame(width: 20, height: 20)
                            .background(Circle().fill(Color(uiColor: .systemBackground)))
                            .overlay(Circle().strokeBorder(plan.bright.opacity(0.7), lineWidth: 1.5))
                            .offset(x: min(max(0, x - 10), proxy.size.width - 20))
                    }
                    .frame(maxHeight: .infinity)
                }
                .frame(height: 20)
                HStack(alignment: .firstTextBaseline) {
                    Text(start, format: format)
                    Spacer(minLength: 4)
                    TimeLeft(resetsAt: resetsAt, now: now)
                        .font(.system(size: 10.5, weight: .semibold))
                        .foregroundStyle(plan.bright)
                    Spacer(minLength: 4)
                    Text(resetsAt, format: format)
                }
                .font(.system(size: 10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
    }

    /// A week starts and resets on the same weekday, so its ends are told apart by date.
    private var format: Date.FormatStyle {
        window.span == .week ? .dateTime.month(.abbreviated).day() : .dateTime.hour().minute()
    }
}

/// The plan's other windows on one line, as many as it holds: a dot of its colour, what each covers,
/// and its share.
struct OtherWindows: View {
    let plan: UsagePlan
    let windows: [LimitWindow]
    let now: Date

    var body: some View {
        ViewThatFits(in: .horizontal) {
            ForEach((1...max(1, windows.count)).reversed(), id: \.self) { count in
                line(Array(windows.prefix(count)))
            }
        }
    }

    private func line(_ windows: [LimitWindow]) -> some View {
        HStack(spacing: 12) {
            ForEach(windows) { window in
                HStack(spacing: 4) {
                    Circle()
                        .fill(plan.meterColors(window.severity(at: now)).last ?? plan.tint)
                        .frame(width: 5, height: 5)
                    Text(window.shortScope ?? window.span.title)
                        .foregroundStyle(.secondary)
                    Text("\(Int((window.used(at: now) * 100).rounded()))%")
                        .monospacedDigit()
                    if window.scope != nil {
                        Text(window.span.shortTitle.lowercased())
                            .foregroundStyle(.tertiary)
                    }
                }
                .fixedSize()
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 11, weight: .semibold))
        .lineLimit(1)
    }
}

/// "2d 4h left" beyond a day; within one, a countdown that keeps itself current.
struct TimeLeft: View {
    let resetsAt: Date
    let now: Date

    var body: some View {
        let seconds = Int(resetsAt.timeIntervalSince(now))
        if seconds < 20 * 3600 {
            Text("\(Text(timerInterval: now...resetsAt, countsDown: true)) left")
        } else {
            Text("\(seconds / 86_400)d \(seconds % 86_400 / 3600)h left")
        }
    }
}
