import BroskiCore
import Testing

@testable import Broski

struct InboxTests {
    private func row(
        _ id: String, _ state: InboxState, _ updatedAt: Int64, machine: String = "m1",
        command: String? = nil, pending: PendingAsk? = nil
    ) -> InboxRow {
        InboxRow(
            machineId: machine, machineName: "Studio Mac", session: SessionRef(backend: .claudeCode, sessionId: id),
            title: id, cwd: "/Users/me/broski", state: state, updatedAt: updatedAt,
            ask: state == .needsYou ? "Allow Bash command?" : nil, command: command, pending: pending,
            cached: false)
    }

    private func option(_ id: String, _ effect: PermissionEffect) -> PermissionOption {
        PermissionOption(
            id: id, label: id, effect: effect, scope: .once, stopsRun: false, message: .none, rule: nil)
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

    @Test func aRowOffersOnlyTheOptionsItsPendingAskCarries() {
        let both = PendingAsk(
            interactionId: "i1", kind: .toolPermission, allow: option("allow", .allow), deny: option("deny", .deny))
        let row = row("ask", .needsYou, 1, pending: both)
        #expect(row.quickOption(.approve)?.id == "allow")
        #expect(row.quickOption(.deny)?.id == "deny")

        let denyOnly = PendingAsk(interactionId: "i2", kind: .toolPermission, allow: nil, deny: option("deny", .deny))
        #expect(self.row("grants", .needsYou, 1, pending: denyOnly).quickOption(.approve) == nil)
        let question = PendingAsk(interactionId: "i3", kind: .questions, allow: nil, deny: nil)
        let asking = self.row("question", .needsYou, 1, pending: question)
        #expect(asking.quickOption(.approve) == nil && asking.quickOption(.deny) == nil, "opens the chat")
        let unviewed = self.row("unviewed", .needsYou, 1)
        #expect(unviewed.quickOption(.approve) == nil && unviewed.quickOption(.deny) == nil)
    }

    @Test func aNeedsYouRowSaysWhatTheAgentWantsInItsOwnWords() {
        #expect(row("a", .needsYou, 1, command: "npm test").askLine == "Claude Code wants to run npm test")
        #expect(row("b", .needsYou, 1).askLine == "Allow Bash command?")
        #expect(row("c", .working, 1, command: "npm test").askLine == nil)
    }

    @Test func rowsOfTheSameSessionOnTwoMachinesStayApart() {
        let first = row("same", .idle, 1, machine: "m1")
        let second = row("same", .idle, 1, machine: "m2")
        #expect(first.key != second.key)
    }
}
