import ActivityKit
import Foundation

/// The one Live Activity Broski shows while agents run: a summary across every live session on
/// every Mac, and the focused one (the session that most needs a look) with its elapsed time and
/// Stop. Everything changes as sessions come and go, so it all lives in the state.
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
        /// When Broski first saw the focused session live.
        var startedAt: Date
        /// The live sessions, the focused one first, at most `listed`.
        var runs: [Run]
        var liveCount: Int
        var needsYouCount: Int

        var agentName: String { backend == "pi" ? "Pi" : "Claude Code" }
        var monogram: String { backend == "pi" ? "Pi" : "CC" }

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

    var symbol: String {
        switch self {
        case .working: "circle.dashed"
        case .needsYou: "exclamationmark.shield"
        case .done: "checkmark.circle"
        }
    }
}
