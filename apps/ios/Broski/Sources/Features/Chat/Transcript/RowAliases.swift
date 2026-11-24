/// When a run ends, the transcript's newest page replaces its live rows (contract §8). Pi names
/// its items only once it has saved them, so the transcript's ids for the run's reasoning, text and
/// answer differ from the live ones, and every row of the run would be torn down and drawn again,
/// losing what the person opened in it. The person's message keeps its id in both (its client
/// request), so from it the two runs are walked side by side, row kind by row kind, and each
/// transcript row is given the id its live row had.
enum RowAliases {
    /// Adds to `aliases` (transcript id → live id) the rows of `live` that `history` now holds.
    static func learn(live: [ChatRow], history: [ChatRow], into aliases: inout [String: String]) {
        guard let start = live.firstIndex(where: \.isPersonsMessage),
            let match = history.firstIndex(where: { $0.id == live[start].id })
        else { return }
        var taken = Set(history.map { aliases[$0.id] ?? $0.id })
        var liveIndex = start
        var historyIndex = match
        while liveIndex < live.count, historyIndex < history.count {
            let mine = live[liveIndex]
            let theirs = history[historyIndex]
            if mine.kind == theirs.kind {
                if mine.id != theirs.id, aliases[theirs.id] == nil, !taken.contains(mine.id) {
                    aliases[theirs.id] = mine.id
                    taken.insert(mine.id)
                }
                liveIndex += 1
                historyIndex += 1
            } else if theirs.kind.isTranscriptOnly {
                historyIndex += 1
            } else {
                liveIndex += 1
            }
        }
    }
}

nonisolated extension ChatRow {
    /// What a row is, for matching a live run's rows to the transcript's.
    enum Kind: Equatable {
        case message, work, group, text, answerEnd, notice, activity, marker

        /// Rows only the transcript has: the live run carries no notices, compactions, model
        /// changes or per-answer copy footers (they show in the live state or after the run ends).
        var isTranscriptOnly: Bool { self == .notice || self == .marker || self == .answerEnd }
    }

    var kind: Kind {
        switch content {
        case .user, .pending: .message
        case .work: .work
        case .group: .group
        case .text: .text
        case .answerEnd: .answerEnd
        case .notice: .notice
        case .activity: .activity
        case .marker: .marker
        }
    }

    var isPersonsMessage: Bool { kind == .message }
}
