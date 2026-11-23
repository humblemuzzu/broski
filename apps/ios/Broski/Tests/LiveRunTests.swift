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
        #expect(state.isMany && state.countLine == "2 agents running" && state.needsYouLine == nil)
        #expect(!state.spansMachines, "both run on one Mac, which goes unnamed")
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
        #expect(state.countLine == "7 agents running" && state.needsYouLine == "1 needs you")
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

    @Test func aMutedSessionIsLeftOutAndAnActivityOfNothingButMutedSessionsEnds() throws {
        var tracker = LiveRunTracker()
        let machine = "00112233445566778899aabbccddeeff"
        let quiet = SessionTarget(machineId: machine, session: SessionRef(backend: "claude-code", sessionId: "quiet"))
        let rows = [row("quiet", .needsYou, at: 9), row("loud", .working, at: 1)]
        guard case .show(let state) = tracker.state(for: rows, muted: [quiet], now: .now) else {
            Issue.record("expected .show")
            return
        }
        #expect(state.sessionId == "loud" && state.liveCount == 1 && state.needsYouCount == 0)
        #expect(!state.isMany, "one that is left is shown as itself")
        let now = Date(timeIntervalSince1970: 1_760_000_000)
        #expect(
            tracker.state(for: [row("quiet", .working, at: 9)], muted: [quiet], now: now)
                == .none(endedAtMs: 1_760_000_000_000))
    }

    @Test func aSessionWithoutATitleIsNamedByItsFolder() {
        let untitled = InboxRow(
            machineId: "m", machineName: "Studio Mac", session: SessionRef(backend: "pi", sessionId: "s"), title: nil,
            cwd: "/Users/dev/broski", state: .working, updatedAt: 1, runStartedAt: nil, ask: nil, command: nil,
            pending: nil, cached: false)
        var tracker = LiveRunTracker()
        guard case .show(let state) = tracker.state(for: [untitled], now: .now) else {
            Issue.record("expected .show")
            return
        }
        #expect(state.title == "broski")
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

    /// A bridge may name its agent with up to 1,024 characters; the state ActivityKit holds to 4 KB
    /// keeps only the first 40 scalars of it, and no accent that is not one.
    @Test func aLongAgentNameIsCutBeforeItReachesTheActivity() throws {
        var tracker = LiveRunTracker()
        let long = AgentBrand(
            backend: "my-agent", name: String(repeating: "代理", count: 512), accentHex: String(repeating: "#", count: 900),
            logo: nil)
        guard case .show(let state) = tracker.state(
            for: [row("a", .working, at: 1, backend: "my-agent")],
            brands: ["00112233445566778899aabbccddeeff": ["my-agent": long]], now: .now)
        else {
            Issue.record("expected .show")
            return
        }
        let agent = try #require(state.agent)
        #expect(agent.name == String(repeating: "代理", count: 20))
        #expect(agent.accentHex == nil)
        #expect(try JSONEncoder().encode(state).count < 1024)
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
