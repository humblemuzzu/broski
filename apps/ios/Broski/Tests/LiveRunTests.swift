import BroskiCore
import Foundation
import Testing

@testable import Broski

/// What the Live Activity shows, chosen from the inbox's rows.
@Suite
struct LiveRunTests {
    @Test func nothingLiveShowsNothing() {
        var tracker = LiveRunTracker()
        #expect(tracker.state(for: [row("a", .done, at: 5), row("b", .idle, at: 9)], now: .now) == nil)
    }

    @Test func theMostRecentlyUpdatedWorkingSessionIsFocusedAndEveryLiveOneSummarised() throws {
        var tracker = LiveRunTracker()
        let shown = tracker.state(for: [row("old", .working, at: 1), row("new", .working, at: 7), row("x", .done, at: 9)], now: .now)
        let state = try #require(shown)
        #expect(state.sessionId == "new")
        #expect(state.phase == .working)
        #expect(state.title == "Session new")
        #expect(state.backend == "claude-code" && state.machineName == "Studio Mac")
        #expect(state.runs.map(\.title) == ["Session new", "Session old"])
        #expect(state.summary == "2 live agents")
    }

    @Test func sessionsThatNeedThePersonComeFirstAndTheSummaryCountsThem() throws {
        var tracker = LiveRunTracker()
        let rows = [row("w1", .working, at: 9), row("ask", .needsYou, at: 2), row("w2", .working, at: 5)]
            + (3...6).map { row("more\($0)", .working, at: Int64($0)) }
        let shown = tracker.state(for: rows, now: .now)
        let state = try #require(shown)
        #expect(state.sessionId == "ask" && state.phase == .needsYou)
        #expect(state.runs.map(\.title) == ["Session ask", "Session w1", "Session more6", "Session w2"], "four at most")
        #expect(state.runs.map(\.phase) == [.needsYou, .working, .working, .working])
        #expect(state.summary == "7 live agents · 1 needs you")
    }

    @Test func elapsedTimeRunsFromWhenASessionWasFirstSeenLiveAndStartsOverAfterItStops() throws {
        var tracker = LiveRunTracker()
        let start = Date(timeIntervalSince1970: 1_000)
        _ = tracker.state(for: [row("a", .working, at: 1)], now: start)
        let asking = tracker.state(for: [row("a", .needsYou, at: 2)], now: start.addingTimeInterval(30))
        #expect(try #require(asking).startedAt == start)

        #expect(tracker.state(for: [row("a", .done, at: 3)], now: start.addingTimeInterval(40)) == nil)
        let again = tracker.state(for: [row("a", .working, at: 4)], now: start.addingTimeInterval(50))
        #expect(try #require(again).startedAt == start.addingTimeInterval(50))
    }

    private func row(_ id: String, _ state: InboxState, at updatedAt: Int64) -> InboxRow {
        InboxRow(
            machineId: "00112233445566778899aabbccddeeff", machineName: "Studio Mac",
            session: SessionRef(backend: .claudeCode, sessionId: id), title: "Session \(id)", cwd: "/w", state: state,
            updatedAt: updatedAt, ask: nil)
    }
}
