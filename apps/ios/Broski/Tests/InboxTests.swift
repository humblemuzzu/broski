import BroskiCore
import Testing

@testable import Broski

struct InboxTests {
    private func row(_ id: String, _ state: InboxState, _ updatedAt: Int64, machine: String = "m1") -> InboxRow {
        InboxRow(
            machineId: machine, machineName: "Studio Mac", session: SessionRef(backend: .pi, sessionId: id),
            title: id, cwd: "/Users/me/broski", state: state, updatedAt: updatedAt,
            ask: state == .needsYou ? "Pi wants to run npm test" : nil)
    }

    /// Rows as the core delivers them: by state, newest first within each.
    private var rows: [InboxRow] {
        [
            row("ask", .needsYou, 900),
            row("run-new", .working, 800, machine: "m2"),
            row("run-old", .working, 100),
            row("done", .done, 700),
            row("idle-new", .idle, 600, machine: "m2"),
            row("idle-old", .idle, 50),
        ]
    }

    @Test func sectionsFollowNeedsYouWorkingDoneIdleAndKeepTheCoresOrderWithin() {
        let sections = InboxSection.group(rows)
        #expect(sections.map(\.state) == [.needsYou, .working, .done, .idle])
        #expect(sections.map { $0.rows.map(\.session.sessionId) } == [
            ["ask"], ["run-new", "run-old"], ["done"], ["idle-new", "idle-old"],
        ])
        #expect(sections.flatMap(\.rows) == rows)
    }

    @Test func emptySectionsAreLeftOut() {
        let sections = InboxSection.group(rows.filter { $0.state != .needsYou && $0.state != .done })
        #expect(sections.map(\.state) == [.working, .idle])
        #expect(InboxSection.group([]).isEmpty)
    }

    @Test func theWorkingFilterShowsOnlyWorking() {
        let sections = InboxSection.group(rows, showing: .working)
        #expect(sections.map(\.state) == [.working])
        #expect(sections.first?.rows.count == 2)
        #expect(InboxSection.group(rows.filter { $0.state != .working }, showing: .working).isEmpty)
    }

    @Test func rowsOfTheSameSessionOnTwoMachinesStayApart() {
        let first = row("same", .idle, 1, machine: "m1")
        let second = row("same", .idle, 1, machine: "m2")
        #expect(first.key != second.key)
    }
}
