import Foundation

/// A turn's work as one line above its answer. Between two breaks (the person's message, a notice,
/// an activity, a marker) the agent works in stretches and writes between them, ending on its
/// answer: the words after its last call. Everything up to that last call, the stretches and the
/// words between them, is what the turn did to get there, and folds under one `WorkGroup` row
/// (`Worked for 40m · Edited 3 files · Ran 12 commands`) when there is more than one stretch's
/// worth to hide. A turn that ends on a call has no answer yet (or none at all): all of it folds.
/// A single stretch followed by the answer is already one line, its own fold.
enum WorkGroups {
    /// `rows` with a group row put above each stretch that folds. `from` skips the row a timeline
    /// continues; `startedAt` is when each stretch's first row began, by its id (nothing when the
    /// page of history was cut inside the turn, so the line never states a time it cannot know).
    static func grouping(_ rows: [ChatRow], from start: Int, startedAt: [String: Int64]) -> [ChatRow] {
        var grouped = Array(rows[..<start])
        var index = start
        while index < rows.count {
            let end = rows[index...].firstIndex { $0.content.isBreak } ?? rows.count
            grouped += group(rows[index..<end], startedAt: startedAt)
            if end < rows.count { grouped.append(rows[end]) }
            index = end + 1
        }
        return grouped
    }

    private static func group(_ stretch: ArraySlice<ChatRow>, startedAt: [String: Int64]) -> [ChatRow] {
        guard let last = stretch.lastIndex(where: { $0.content.isWork }) else { return Array(stretch) }
        let members = stretch[stretch.startIndex...last]
        guard members.count > 1, let first = members.first else { return Array(stretch) }
        let folds = members.compactMap { row -> WorkFold? in
            if case .work(let fold) = row.content { fold } else { nil }
        }
        let summary = WorkSummary(
            folds: folds, startedAt: startedAt[first.id], endedAt: folds.compactMap(\.endedAt).max(),
            isLive: folds.last?.isLive ?? false, isContinuation: false)
        let header = ChatRow(
            id: "group-" + first.id, content: .group(WorkGroup(members: members.count, summary: summary)), gap: first.gap)
        return [header] + stretch
    }

    /// What the transcript draws: with folding on, each group's row and, once the person has opened
    /// it, the rows it holds (`revealed`); with it off, the rows alone, as they were before groups.
    static func shown(_ rows: [ChatRow], collapsing: Bool, isOpen: (String) -> Bool) -> (rows: [ChatRow], revealed: Set<String>) {
        var shown: [ChatRow] = []
        var revealed: Set<String> = []
        shown.reserveCapacity(rows.count)
        var index = 0
        while index < rows.count {
            let row = rows[index]
            index += 1
            guard case .group(let group) = row.content else {
                shown.append(row)
                continue
            }
            let members = rows[index..<min(rows.count, index + group.members)]
            index += members.count
            guard collapsing else {
                shown += members
                continue
            }
            shown.append(row)
            guard isOpen(row.id), var first = members.first else { continue }
            first.gap = ChatRow.gap(between: row.content, and: first.content)
            shown.append(first)
            shown += members.dropFirst()
            revealed.formUnion(members.map(\.id))
        }
        return (shown, revealed)
    }

    /// How many messages `rows` hold as a reader counts them, with every group folded.
    static func messageCount(in rows: [ChatRow]) -> Int {
        shown(rows, collapsing: true) { _ in false }.rows.count(where: \.startsMessage)
    }
}

nonisolated extension ChatRow.Content {
    /// A row that ends a stretch of work: what the person or the transcript puts between turns.
    var isBreak: Bool {
        switch self {
        case .user, .pending, .notice, .activity, .marker: true
        case .work, .group, .text, .answerEnd: false
        }
    }

    var isWork: Bool {
        if case .work = self { true } else { false }
    }
}
