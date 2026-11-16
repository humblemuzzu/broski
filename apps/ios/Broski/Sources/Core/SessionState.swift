import BroskiCore

/// What a session view says that is not state: shown once, then gone (mobile-core.md, "The update
/// protocol"). `runEnded` carries the items a run had when it ended (its last items may come in the
/// same batch), which stay on screen until the transcript's newest page holds them; `activity` is one
/// outside any run, which stays the same way.
enum SessionMoment: Equatable {
    case notice(NoticeEvent)
    case activity(ActivityItem)
    case error(ErrorEvent)
    case inputReturned([String])
    case rateLimit(RateLimitUpdate)
    case runEnded([TranscriptItem])
}

/// The chat's copy of one session view. It assigns what each update carries and never reduces, so
/// after every update its snapshot equals `SessionView.snapshot()`.
struct SessionState: Equatable {
    private(set) var session: SessionRef?
    private(set) var capabilities: SessionCapabilities?
    private(set) var snapshot = SessionSnapshot.empty
    private(set) var status: SessionStatus?
    private(set) var ended: ViewEnd?

    var isRunning: Bool { snapshot.run != nil }

    /// Applies one update; returns the moments it carried, in order.
    mutating func apply(_ update: SessionUpdate) -> [SessionMoment] {
        var moments: [SessionMoment] = []
        switch update {
        case .reset(let session, let capabilities, let snapshot, let status):
            if let ended = self.snapshot.run.ended(by: snapshot.run) { moments.append(.runEnded(ended.items)) }
            self.session = session
            self.capabilities = capabilities
            self.snapshot = snapshot
            self.status = status
        case .changes(let changes, let status):
            for change in changes {
                if case .runChanged(let run) = change, let ended = snapshot.run.ended(by: run) {
                    moments.append(.runEnded(ended.items))
                }
                if let moment = snapshot.apply(change) { moments.append(moment) }
            }
            self.status = status
        case .ended(let reason):
            ended = reason
        }
        return moments
    }
}

extension ActiveRun? {
    /// This run, when `next` ends it: no run follows, or another run does. A run that only lost
    /// items (a retraction, a replacement) goes on under its own id.
    fileprivate func ended(by next: ActiveRun?) -> ActiveRun? {
        guard let self, next?.runId != self.runId else { return nil }
        return self
    }
}

extension SessionSnapshot {
    static let empty = SessionSnapshot(
        run: nil, blocks: [], tools: [], interactions: [], queue: [], backgroundTasks: [], modelId: nil, thinking: nil,
        modes: [], usage: nil, compaction: nil, retry: nil, lastOutcome: nil)

    /// Assigns one record as mobile-core.md's table says; the records that are not state come back.
    fileprivate mutating func apply(_ change: SessionChange) -> SessionMoment? {
        switch change {
        case .runChanged(let run): self.run = run
        case .runItemAppended(let item): run?.items.append(item)
        case .runItemReplaced(let index, let item): run?.items[Int(index)] = item
        case .runItemsDropped(let count, let droppedItems):
            run?.items.removeFirst(Int(count))
            run?.droppedItems = droppedItems
        case .blockOpened(let block): blocks.append(block)
        case .blockTextChanged(let blockId, let text):
            if let index = blocks.firstIndex(where: { $0.blockId == blockId }) { blocks[index].text = text }
        case .blockClosed(let blockId): blocks.removeAll { $0.blockId == blockId }
        case .toolOpened(let tool): tools.append(tool)
        case .toolChanged(let tool):
            if let index = tools.firstIndex(where: { $0.toolCallId == tool.toolCallId }) { tools[index] = tool }
        case .toolClosed(let toolCallId): tools.removeAll { $0.toolCallId == toolCallId }
        case .interactionAdded(let interaction): interactions.append(interaction)
        case .interactionRemoved(let interactionId): interactions.removeAll { $0.id == interactionId }
        case .queueChanged(let items): queue = items
        case .backgroundTasksChanged(let tasks): backgroundTasks = tasks
        case .modelChanged(let modelId, let thinking):
            self.modelId = modelId
            self.thinking = thinking
        case .modesChanged(let modes): self.modes = modes
        case .usageChanged(let usage): self.usage = usage
        case .compactionChanged(let compaction): self.compaction = compaction
        case .retryChanged(let retry): self.retry = retry
        case .outcomeChanged(let outcome): lastOutcome = outcome
        case .noticeShown(let notice): return .notice(notice)
        case .activityShown(let item): return .activity(item)
        case .errorShown(let error): return .error(error)
        case .inputReturned(let texts): return .inputReturned(texts)
        case .extensionReceived(.rateLimit(let update)): return .rateLimit(update)
        }
        return nil
    }
}
