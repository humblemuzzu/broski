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
        let tools = tools.filter { $0.parentToolCallId == nil }
        let counts = Dictionary(grouping: tools, by: \.kind).mapValues(\.count)
        let duration = isLive ? nil : startedAt.flatMap { start in endedAt.map { Double($0 - start) / 1000 } }
        return WorkSummary(
            verbs: ToolKind.allCases.compactMap { kind in counts[kind].map { (kind, $0) } },
            failed: tools.count(where: \.failed),
            thoughts: entries.count { if case .thinking = $0 { true } else { false } },
            duration: duration,
            isContinuation: isContinuation)
    }
}

/// The fold's one line: `Worked for 2m · Edited 1 file · Ran 2 commands · 1 failed`.
nonisolated struct WorkSummary: Equatable {
    /// What the tools did, most consequential first.
    let verbs: [(kind: ToolKind, count: Int)]
    let failed: Int
    let thoughts: Int
    let duration: TimeInterval?
    let isContinuation: Bool

    /// At most this many verbs; the rest fold into "Used n tools".
    static let shownVerbs = 2

    var lead: String? {
        guard let duration, duration >= 1 else { return nil }
        return "\(isContinuation ? "Continued" : "Worked") for \(Self.format(duration))"
    }

    var phrases: [String] {
        let shown = verbs.prefix(Self.shownVerbs).map { $0.kind.phrase($0.count) }
        let rest = verbs.dropFirst(Self.shownVerbs).reduce(0) { $0 + $1.count }
        var phrases = shown + (rest > 0 ? [ToolKind.other.phrase(rest)] : [])
        if phrases.isEmpty && thoughts > 0 { phrases = ["Thought"] }
        return phrases
    }

    /// The line without the failures, which the row shows in red.
    var text: String {
        ([lead].compactMap(\.self) + phrases).joined(separator: " · ")
    }

    var failedText: String? { failed > 0 ? "\(failed) failed" : nil }

    /// "12s", "2m", "1h 5m".
    static func format(_ seconds: TimeInterval) -> String {
        let seconds = Int(seconds.rounded())
        if seconds < 60 { return "\(seconds)s" }
        if seconds < 3600 { return "\(seconds / 60)m" }
        let minutes = seconds / 60 % 60
        return minutes == 0 ? "\(seconds / 3600)h" : "\(seconds / 3600)h \(minutes)m"
    }

    static func == (lhs: WorkSummary, rhs: WorkSummary) -> Bool {
        lhs.text == rhs.text && lhs.failed == rhs.failed
    }
}
