import BroskiCore
import SwiftUI

/// A paired Mac as a live link: a wave of capsules, one per round trip to its bridge, each reaching
/// out from the centre line as far as that trip was slow, sliding left as new ones grow in at the right
/// and fading as they age; under it the Mac, the last round trip in milliseconds, and how the phone
/// reaches it. A trip that does not come back in time is a dot in the caution colour. It measures only while it is on screen in
/// an active app, and only while the Mac is ready.
struct LinkCard: View {
    let machine: MachineModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var beats: [Beat] = []
    @State private var count = 0

    struct Beat: Identifiable, Equatable {
        let id: Int
        /// The round trip in milliseconds; nil when it did not come back in time.
        let ms: Double?
    }

    /// How long a round trip may take before it counts as missed.
    static let patience: Duration = .seconds(4)
    static let interval: Duration = .seconds(1)
    /// Kept for the widest strip; a narrower one shows the newest that fit.
    static let kept = 64

    private var summary: MachineSummary { machine.summary }
    private var latest: Double? { beats.last?.ms }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            LinkStrip(beats: beats, isLive: summary.isReady)
                .frame(height: 56)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                    Text(machine.name)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: Spacing.s)
                    if summary.isReady, let latest {
                        Text("\(Int(latest.rounded())) ms")
                            .font(.system(.subheadline, design: .rounded).weight(.semibold))
                            .monospacedDigit()
                            .contentTransition(.numericText(value: latest))
                    }
                }
                HStack(spacing: Spacing.xs + Spacing.xxs) {
                    Circle().fill(summary.health.dot).frame(width: 7, height: 7)
                    Text(route)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .font(.subheadline)
                .foregroundStyle(summary.health == .ready ? AnyShapeStyle(.secondary) : AnyShapeStyle(Palette.caution))
            }
        }
        .padding(.vertical, Spacing.xs)
        .animation(.smooth(duration: 0.45), value: count)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .task(id: Measuring(machine: machine.id, ready: summary.isReady, active: scenePhase == .active)) {
            guard summary.isReady, scenePhase == .active else { return }
            await measure()
        }
    }

    /// "On this network · 192.168.1.20:18275", "Through the relay", or what is wrong.
    private var route: String {
        guard summary.isReady else { return summary.line }
        let link = machine.status.link
        let way = link.route == .lan ? "On this network" : "Through the relay"
        return [way, link.routeDetail].compactMap(\.self).joined(separator: " · ")
    }

    private var accessibilityText: String {
        let trip = summary.isReady ? latest.map { ", \(Int($0.rounded())) milliseconds" } ?? "" : ""
        return "\(machine.name), \(route)\(trip)"
    }

    private func measure() async {
        while !Task.isCancelled {
            let ms = await Self.roundTrip(machine.machine)
            guard !Task.isCancelled else { return }
            count += 1
            beats.append(Beat(id: count, ms: ms))
            if beats.count > Self.kept { beats.removeFirst(beats.count - Self.kept) }
            try? await Task.sleep(for: Self.interval)
        }
    }

    /// From the phone to the Mac's bridge and back: the smallest question the bridge answers itself.
    private static func roundTrip(_ machine: Machine) async -> Double? {
        await withTaskGroup(of: Double?.self) { group in
            group.addTask {
                let clock = ContinuousClock()
                let start = clock.now
                guard (try? await machine.request(message: .workspaceInfo(WorkspaceInfoRequest(requestId: "")))) != nil else { return nil }
                let took = start.duration(to: clock.now).components
                return Double(took.seconds) * 1000 + Double(took.attoseconds) / 1e15
            }
            group.addTask {
                try? await Task.sleep(for: patience)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    private struct Measuring: Equatable {
        let machine: String
        let ready: Bool
        let active: Bool
    }
}

/// The beats as a wave of capsules about a centre line, newest at the right, older ones fading out.
/// Each reaches between a fifth and all of the height by where its round trip falls between the
/// quickest and the slowest shown, over a spread of at least `spread`, on a square-root curve: a
/// steady link breathes gently and keeps breathing beside a slow trip, which stands out. Slots not yet measured are a flat line of dots; a missed beat is a caution
/// dot. Not live, the wave rests dimmed.
private struct LinkStrip: View {
    let beats: [LinkCard.Beat]
    let isLive: Bool

    private static let bar: CGFloat = 3
    private static let gap: CGFloat = 3
    /// The smallest spread of round trips the wave stretches over, so jitter of a few milliseconds
    /// does not fill the height.
    private static let spread: Double = 25

    var body: some View {
        GeometryReader { proxy in
            let slots = max(1, Int((proxy.size.width + Self.gap) / (Self.bar + Self.gap)))
            let shown = Array(beats.suffix(slots))
            let trips = shown.compactMap(\.ms)
            let low = trips.min() ?? 0
            let high = max(trips.max() ?? 0, low + Self.spread)
            HStack(alignment: .center, spacing: Self.gap) {
                ForEach(0..<(slots - shown.count), id: \.self) { _ in dot(Color.primary.opacity(0.12)) }
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, beat in
                    let age = Double(shown.count - 1 - index) / Double(slots)
                    Group {
                        if let ms = beat.ms {
                            Capsule()
                                .fill(Color.primary.opacity(0.95 - 0.75 * age))
                                .frame(width: Self.bar, height: proxy.size.height * (0.2 + 0.8 * ((ms - low) / (high - low)).squareRoot()))
                        } else {
                            dot(Palette.caution.opacity(0.95 - 0.6 * age))
                        }
                    }
                    .transition(.asymmetric(insertion: .scale(scale: 0.1).combined(with: .opacity), removal: .opacity))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .trailing)
        }
        .opacity(isLive ? 1 : 0.4)
        .accessibilityHidden(true)
    }

    private func dot(_ fill: Color) -> some View {
        Capsule().fill(fill).frame(width: Self.bar, height: Self.bar)
    }
}
