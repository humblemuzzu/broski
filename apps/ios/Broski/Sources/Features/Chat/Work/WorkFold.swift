import BroskiCore
import Foundation

/// One stretch of an agent's work between the person's message, the agent's words and the next:
/// its tool calls and reasoning, folded into one row (design.md, "Work folds per turn").
nonisolated struct WorkFold: Equatable, Identifiable {
    let id: String
    var entries: [WorkEntry]
    /// When the stretch began (the item before it) and when its newest entry was written.
    var startedAt: Int64?
    var endedAt: Int64?
    /// Still being written: the run is live and nothing has come after it.
    var isLive = false
    /// Not the turn's first stretch: the agent wrote between this and the one before.
    var isContinuation = false

    var tools: [ToolWork] {
        entries.compactMap { if case .tool(let tool) = $0 { tool } else { nil } }
    }

    var summary: WorkSummary {
        WorkSummary(folds: [self], startedAt: startedAt, endedAt: endedAt, isLive: isLive, isContinuation: isContinuation)
    }
}

/// The line of a fold, or of a turn's whole work (`WorkGroup`): `Worked for 2m · Edited 1 file ·
/// Ran 2 commands · 1 failed`, or for work that only reasoned, `Thinking` while it does and
/// `Thought for 12s` once it is done.
nonisolated struct WorkSummary: Equatable {
    /// What the tools did, most consequential first, as the core words it: at most two verbs, the rest as "Used n tools".
    let counts: [FoldCount]
    let failed: Int
    let thoughts: Int
    let duration: TimeInterval?
    let isContinuation: Bool
    var isLive = false

    private var onlyThought: Bool { counts.isEmpty && thoughts > 0 }

    var lead: String? {
        guard let duration, duration >= 1 else { return nil }
        if onlyThought { return "Thought for \(Self.format(duration))" }
        return "\(isContinuation ? "Continued" : "Worked") for \(Self.format(duration))"
    }

    var phrases: [String] {
        guard onlyThought else { return counts.map(\.phrase) }
        return lead == nil ? [isLive ? "Thinking" : "Thought"] : []
    }

    /// The line without the failures, which the row shows in red.
    var text: String {
        let line = ([lead].compactMap(\.self) + phrases).joined(separator: " · ")
        return line.isEmpty && failed == 0 ? (isLive ? "Working" : "Worked") : line
    }

    var failedText: String? { failed > 0 ? "\(failed) failed" : nil }

    /// "12s", "2m", "1h 5m", as the core words a duration for both apps.
    static func format(_ seconds: TimeInterval) -> String {
        formatDuration(milliseconds: Int64((seconds * 1000).rounded()))
    }

    static func == (lhs: WorkSummary, rhs: WorkSummary) -> Bool {
        lhs.text == rhs.text && lhs.failed == rhs.failed
    }
}

nonisolated extension WorkSummary {
    /// The line for `folds` between `startedAt` and `endedAt`: what their top-level calls did, in
    /// the core's words, and how long it took once nothing is still being written.
    init(folds: [WorkFold], startedAt: Int64?, endedAt: Int64?, isLive: Bool, isContinuation: Bool) {
        let tools = folds.flatMap(\.tools).filter { $0.parentToolCallId == nil }
        self.init(
            counts: foldCounts(tools: tools.map { FoldTool(id: $0.id, kind: $0.kind, paths: $0.look.paths) }),
            failed: tools.count(where: \.failed),
            thoughts: folds.reduce(0) { $0 + $1.entries.count { if case .thinking = $0 { true } else { false } } },
            duration: isLive ? nil : startedAt.flatMap { start in endedAt.map { Double(max(0, $0 - start)) / 1000 } },
            isContinuation: isContinuation,
            isLive: isLive)
    }
}
