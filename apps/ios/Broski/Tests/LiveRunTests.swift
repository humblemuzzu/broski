import BroskiCore
import Foundation
import Testing

@testable import Broski

/// What the Live Activity shows, chosen from the inbox's rows.
@Suite
struct LiveRunTests {
    @Test func nothingLiveShowsNothing() {
        var tracker = LiveRunTracker()
        let now = Date(timeIntervalSince1970: 1_760_000_000)
        let decision = tracker.state(for: [row("a", .done, at: 5), row("b", .idle, at: 9)], now: now)
        #expect(decision == .none(endedAtMs: 1_760_000_000_000))
    }

    @Test func settlingMachinesPreserveExistingActivityInsteadOfWipingIt() {
        var tracker = LiveRunTracker()
        let decision = tracker.state(
            for: [row("a", .working, at: 5, cached: true)],
            readyMachines: [],
            settlingMachines: ["00112233445566778899aabbccddeeff"],
            now: .now)
        #expect(decision == .keep)
    }

    @Test func theMostRecentlyUpdatedWorkingSessionIsFocusedAndUsesAuthoritativeRunStartedAt() throws {
        var tracker = LiveRunTracker()
        let realStart: Int64 = 1_760_000_000_000
        let lastMessage: Int64 = 1_760_000_300_000
        let now = Date(timeIntervalSince1970: 1_760_000_305)
        let decision = tracker.state(
            for: [
                row("old", .working, at: lastMessage - 60_000, runStartedAt: realStart - 60_000),
                row("new", .working, at: lastMessage, runStartedAt: realStart),
                row("x", .done, at: lastMessage + 1_000),
            ],
            now: now)
        guard case .show(let state) = decision else {
            Issue.record("expected .show, got \(decision)")
            return
        }
        #expect(state.sessionId == "new")
        #expect(state.phase == .working)
        #expect(state.startedAtMs == realStart)
        #expect(state.endedAtMs == nil)
        #expect(state.title == "Session new")
        #expect(state.backend == "claude-code" && state.machineName == "Studio Mac")
        #expect(state.runs.map(\.title) == ["Session new", "Session old"])
        #expect(state.summary == "2 live agents")
    }

    @Test func sessionsThatNeedThePersonComeFirstAndTheSummaryCountsThem() throws {
        var tracker = LiveRunTracker()
        let rows = [row("w1", .working, at: 9), row("ask", .needsYou, at: 2), row("w2", .working, at: 5)]
            + (3...6).map { row("more\($0)", .working, at: Int64($0)) }
        guard case .show(let state) = tracker.state(for: rows, now: .now) else {
            Issue.record("expected .show")
            return
        }
        #expect(state.sessionId == "ask" && state.phase == .needsYou)
        #expect(state.runs.map(\.title) == ["Session ask", "Session w1", "Session more6", "Session w2"], "four at most")
        #expect(state.runs.map(\.phase) == [.needsYou, .working, .working, .working])
        #expect(state.summary == "7 live agents · 1 needs you")
    }

    @Test func fallbackStartSurvivesReconnectAndResetsOnlyWhenSessionSettles() throws {
        var tracker = LiveRunTracker()
        let start = Date(timeIntervalSince1970: 1_000)
        _ = tracker.state(for: [row("a", .working, at: 1)], now: start)

        // Machine briefly settles/reconnects: must not lose the start time.
        #expect(
            tracker.state(
                for: [],
                readyMachines: [],
                settlingMachines: ["00112233445566778899aabbccddeeff"],
                now: start.addingTimeInterval(15)) == .keep)

        guard case .show(let asking) = tracker.state(for: [row("a", .needsYou, at: 2)], now: start.addingTimeInterval(30))
        else {
            Issue.record("expected .show")
            return
        }
        #expect(asking.startedAtMs == 1_000_000)

        let settledAt = start.addingTimeInterval(40)
        #expect(tracker.state(for: [row("a", .done, at: 3)], now: settledAt) == .none(endedAtMs: 1_040_000))

        guard case .show(let again) = tracker.state(for: [row("a", .working, at: 4)], now: start.addingTimeInterval(50))
        else {
            Issue.record("expected .show")
            return
        }
        #expect(again.startedAtMs == 1_050_000)
    }

    @Test func daemonApnsContentStateJsonDecodesIdentically() throws {
        let json = """
        {
          "phase": "done",
          "title": "Refactor timers",
          "machineId": "00112233445566778899aabbccddeeff",
          "machineName": "Studio Mac",
          "backend": "pi",
          "sessionId": "s-1",
          "startedAtMs": 1760000000000,
          "endedAtMs": 1760000060000,
          "runs": [{"title": "Refactor timers", "machineName": "Studio Mac", "phase": "working"}],
          "liveCount": 1,
          "needsYouCount": 0
        }
        """
        let state = try JSONDecoder().decode(RunActivityAttributes.ContentState.self, from: Data(json.utf8))
        #expect(state.phase == .done)
        #expect(state.startedAtMs == 1_760_000_000_000)
        #expect(state.endedAtMs == 1_760_000_060_000)
        #expect(state.deepLinkURL?.absoluteString == "broski://session?machine=00112233445566778899aabbccddeeff&backend=pi&session=s-1")
        #expect(state.agent == nil)
        #expect(state.brand.name == "Pi" && state.brand.logo == .pi, "the daemon names only the backend")
    }

    /// The focused session's agent goes into the state as its bridge describes it, and survives the
    /// JSON ActivityKit keeps the state as; a session whose bridge said nothing reads its id.
    @Test func theFocusedAgentIsDrawnAsItsBridgeDescribesIt() throws {
        var tracker = LiveRunTracker()
        let codex = AgentBrand(backend: "codex", name: "Codex", accentHex: "#10A37F", logo: nil)
        let rows = [row("a", .working, at: 9, backend: "codex"), row("b", .working, at: 1, backend: "my-agent")]
        guard case .show(let state) = tracker.state(
            for: rows, brands: ["00112233445566778899aabbccddeeff": ["codex": codex]], now: .now)
        else {
            Issue.record("expected .show")
            return
        }
        #expect(state.backend == "codex" && state.brand == codex)
        let stored = try JSONDecoder().decode(
            RunActivityAttributes.ContentState.self, from: JSONEncoder().encode(state))
        #expect(stored.brand == codex)

        guard case .show(let other) = tracker.state(for: [row("b", .needsYou, at: 2, backend: "my-agent")], now: .now)
        else {
            Issue.record("expected .show")
            return
        }
        #expect(other.agent == nil)
        #expect(other.brand.name == "My Agent" && other.brand.logo == nil && other.brand.initials == "MA")
    }

    private func row(
        _ id: String,
        _ state: InboxState,
        at updatedAt: Int64,
        runStartedAt: Int64? = nil,
        cached: Bool = false,
        backend: String = "claude-code"
    ) -> InboxRow {
        InboxRow(
            machineId: "00112233445566778899aabbccddeeff", machineName: "Studio Mac",
            session: SessionRef(backend: backend, sessionId: id), title: "Session \(id)", cwd: "/w", state: state,
            updatedAt: updatedAt, runStartedAt: runStartedAt, ask: nil, command: nil, pending: nil, cached: cached)
    }
}
