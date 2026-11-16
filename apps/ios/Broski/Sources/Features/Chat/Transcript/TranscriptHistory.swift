import BroskiCore

/// A session's finished runs as read so far (contract §11.2): pages come newest first and are kept
/// oldest first. The newest page is read again whenever a run ends; with stable ids it replaces
/// what it overlaps and keeps the older pages before it, otherwise it starts the history over.
struct TranscriptHistory: Equatable {
    static let pageSize: Int64 = 100

    private(set) var items: [TranscriptItem] = []
    private(set) var olderCursor: String?
    private(set) var isLoaded = false

    var hasOlder: Bool { olderCursor != nil }

    mutating func setNewest(_ page: TranscriptPage) {
        let newest = Array(page.items.reversed())
        defer { isLoaded = true }
        if isLoaded, page.idStability == .stable, let first = newest.first,
            let overlap = items.firstIndex(where: { $0.id == first.id })
        {
            items = Array(items[..<overlap]) + newest
            return
        }
        items = newest
        olderCursor = page.nextCursor
    }

    mutating func addOlder(_ page: TranscriptPage) {
        let known = Set(items.map(\.id))
        items = page.items.reversed().filter { !known.contains($0.id) } + items
        olderCursor = page.nextCursor
    }

    /// The client request ids of the person's messages, which retire their optimistic bubbles.
    var deliveredRequests: Set<String> { items.deliveredRequests }
}

extension [TranscriptItem] {
    var deliveredRequests: Set<String> {
        Set(compactMap { if case .userMessage(let message) = $0 { message.clientRequestId } else { nil } })
    }
}

extension TranscriptItem {
    var id: String {
        switch self {
        case .userMessage(let item): item.id
        case .block(let item): item.id
        case .toolCall(let item): item.id
        case .toolResult(let item): item.id
        case .notice(let item): item.id
        case .activity(let item): item.id
        case .compaction(let item): item.id
        case .modelChange(let item): item.id
        case .runBoundary(let item): item.id
        }
    }
}
