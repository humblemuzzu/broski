import ActivityKit
import Foundation

/// The one Live Activity Broski shows while agents run: a summary across every live session on
/// every Mac, and the focused one (the session that most needs a look) with its elapsed time and
/// Stop. Everything changes as sessions come and go, so it all lives in the state.
///
/// Timestamps are plain Unix epoch milliseconds (`Int64`) rather than `Date` so APNs Live Activity
/// pushes decoded by the system's default `JSONDecoder` match local updates without reference-date
/// drift.
nonisolated struct RunActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable, Sendable {
        enum Phase: String, Codable, Sendable {
            case working
            case needsYou
            case done
        }

        /// One live session in the summary.
        struct Run: Codable, Hashable, Sendable {
            var title: String
            var machineName: String
            var phase: Phase
        }

        static let listed = 4

        var phase: Phase
        var title: String
        var machineId: String
        var machineName: String
        /// The contract's wire name: `claude-code` or `pi`.
        var backend: String
        var sessionId: String
        /// Unix epoch milliseconds when the focused run started.
        var startedAtMs: Int64
        /// Unix epoch milliseconds when the focused run ended, set in `.done`.
        var endedAtMs: Int64?
        /// The live sessions, the focused one first, at most `listed`.
        var runs: [Run]
        var liveCount: Int
        var needsYouCount: Int

        var startedAt: Date { Date(timeIntervalSince1970: TimeInterval(startedAtMs) / 1000) }
        var endedAt: Date? { endedAtMs.map { Date(timeIntervalSince1970: TimeInterval($0) / 1000) } }

        var brand: AgentBrand { AgentBrand(wire: backend) }
        var agentName: String { brand.name }

        /// Deep link that opens the focused session in Broski.
        var deepLinkURL: URL? {
            var components = URLComponents()
            components.scheme = "broski"
            components.host = "session"
            components.queryItems = [
                URLQueryItem(name: "machine", value: machineId),
                URLQueryItem(name: "backend", value: backend),
                URLQueryItem(name: "session", value: sessionId),
            ]
            return components.url
        }

        /// "3 live agents · 1 needs you", or the focused session's state when it is the only one.
        var summary: String {
            guard liveCount > 1 else { return phase.title }
            let live = "\(liveCount) live agents"
            return needsYouCount == 0 ? live : "\(live) · \(needsYouCount) \(needsYouCount == 1 ? "needs" : "need") you"
        }
    }
}

nonisolated extension RunActivityAttributes.ContentState.Phase {
    var title: String {
        switch self {
        case .working: "Working"
        case .needsYou: "Needs you"
        case .done: "Done"
        }
    }

    /// `nil` while working, which shows a still thinking orb (a Live Activity cannot animate one).
    var symbol: String? {
        switch self {
        case .working: nil
        case .needsYou: "hand.raised.fill"
        case .done: "checkmark.circle.fill"
        }
    }
}
