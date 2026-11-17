import BroskiCore
import CoreGraphics

/// One row of the transcript's lazy stack, keyed so a row keeps its identity while text streams:
/// the person's message, a work fold, one text block of the agent's, the quiet line under
/// a finished answer, a notice, an activity, a marker (compaction, model change, how a run ended),
/// or a prompt still on its way.
nonisolated struct ChatRow: Identifiable, Equatable {
    enum Content: Equatable {
        case user(UserTurn)
        case pending(PendingPrompt)
        case work(WorkFold)
        case text(TextPiece)
        case answerEnd(AnswerEnd)
        case notice(NoticeItem)
        case activity(ActivityEntry)
        case marker(Marker)
    }

    let id: String
    let content: Content
    /// Space above the row, from what comes before it.
    var gap: CGFloat = 0

    /// A row that rises in when a live run adds it; the agent's text just appears, block by block.
    var risesIn: Bool {
        switch content {
        case .user, .pending, .work, .notice, .activity, .marker: true
        case .text, .answerEnd: false
        }
    }

    /// A row a reader counts as a new message when it arrives below them.
    var startsMessage: Bool {
        switch content {
        case .user, .pending: true
        case .text: true
        default: false
        }
    }
}

nonisolated struct UserTurn: Equatable {
    let id: String
    let text: String
    let attachments: [AttachmentRef]
    let at: Int64?
}

/// One text block of the agent's; `isStreaming` while it is still open.
nonisolated struct TextPiece: Equatable {
    let blockId: String
    let text: String
    let kind: BlockKind
    let isStreaming: Bool
}

/// Under a finished answer: its time, and the answer's text to copy.
nonisolated struct AnswerEnd: Equatable {
    let text: String
    let at: Int64?
}

nonisolated enum Marker: Equatable {
    case compaction(CompactionItem)
    case model(ModelChangeItem)
    case outcome(RunOutcome)
}
