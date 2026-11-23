import BroskiCore
import CoreGraphics

/// Turns transcript items (oldest first) into the transcript's rows: the person's messages as
/// bubbles, each stretch of tool calls and reasoning as one fold, the agent's text block by block,
/// and a quiet line under each finished answer. A turn that did its work in more than one stretch
/// gets a `WorkGroup` row above it (`WorkGroups`). Pure: the same items give the same rows.
struct ChatTimeline {
    /// A text's formatted blocks, by its text and whether it is still streaming (cached, since a
    /// finished text never changes and only the open one is formatted again).
    let format: @MainActor (_ text: String, _ streaming: Bool) -> [FormatBlock]

    private(set) var rows: [ChatRow] = []
    /// The items start the session: the model settings it opened with are not a switch.
    private let atStart: Bool
    /// `rows` begins with the row this timeline continues, which it must not change.
    private let continues: Bool
    private var fold: WorkFold?
    private var toolsInFold: [String: Int] = [:]
    private var lastAt: Int64?
    private var turnHasText = false
    private var answer: [String] = []
    private var answerAt: Int64?
    /// The pages the turn's searches found, which the answer drew on.
    private var sources: [LinkItem] = []
    private var running: [String: RunningTool] = [:]
    /// Whether the rows since the last message, notice or marker already have their first work or text.
    private var inSegment = false
    /// When each stretch's first row began: the time of the item before it, by the row's id.
    private var segmentStarts: [String: Int64] = [:]
    private var isGrouped = false

    init(
        after previous: ChatRow? = nil, atStart: Bool = false,
        format: @escaping @MainActor (String, Bool) -> [FormatBlock] = FormatCache.shared.blocks
    ) {
        self.format = format
        self.atStart = atStart && previous == nil
        continues = previous != nil
        if let previous {
            rows = [previous]
            turnHasText = previous.isAgentText
        }
    }

    /// The rows this timeline added (without the row it continues from).
    func finished(continuing previous: ChatRow?) -> [ChatRow] {
        previous == nil ? rows : Array(rows.dropFirst())
    }

    mutating func add(_ items: [TranscriptItem]) {
        for item in items { add(item) }
    }

    mutating func add(_ item: TranscriptItem) {
        switch item {
        case .userMessage(let message):
            closeTurn()
            append(
                .user(UserTurn(id: message.id, text: message.text, attachments: message.attachments, at: message.at)),
                id: Self.userRowID(message.id, clientRequestId: message.clientRequestId))
            lastAt = message.at ?? lastAt
        case .block(let block):
            addBlock(id: block.id, kind: block.block, text: block.text, nested: block.parentToolCallId != nil, open: false, at: block.at)
        case .toolCall(let call):
            var tool = running[call.toolCallId].map(ToolWork.init(running:)) ?? ToolWork(call: call)
            if tool.input == nil { tool.input = call.input }
            addWork(.tool(tool), at: call.at)
        case .toolResult(let result):
            finishTool(result)
        case .notice(let notice):
            closeFold()
            append(.notice(notice), id: notice.id)
            lastAt = notice.at ?? lastAt
        case .activity(let activity):
            closeFold()
            closeAnswer()
            append(.activity(ActivityEntry(activity)), id: activity.id)
            lastAt = activity.at
        case .compaction(let compaction):
            closeFold()
            append(.marker(.compaction(compaction)), id: compaction.id)
            lastAt = compaction.at
        case .modelChange(var change):
            closeFold()
            lastAt = change.at ?? lastAt
            // Pi writes a model and its thinking level as two entries: one line says both.
            if case .marker(.model(let earlier)) = rows.last?.content, rows.count > (continues ? 1 : 0) {
                rows.removeLast()
                change.modelId = change.modelId ?? earlier.modelId
                change.thinking = change.thinking ?? earlier.thinking
            }
            guard !(atStart && rows.isEmpty) else { return }
            append(.marker(.model(change)), id: change.id)
        case .runBoundary(let boundary):
            closeFold()
            if case .completed = boundary.outcome {} else {
                append(.marker(.outcome(boundary.outcome)), id: boundary.id)
            }
            lastAt = boundary.at
        }
    }

    /// The live run: its finished items, the running tools among them (which carry the output so
    /// far in place of their call items), then its open blocks.
    mutating func addLive(items: [TranscriptItem], blocks: [OpenBlock], tools: [RunningTool]) {
        running = Dictionary(tools.map { ($0.toolCallId, $0) }, uniquingKeysWith: { $1 })
        add(items)
        for block in blocks {
            addBlock(id: block.blockId, kind: block.kind, text: block.text, nested: block.parentToolCallId != nil, open: true, at: nil)
        }
    }

    /// A prompt on its way, under the id its delivered message will have: the bubble stays the same
    /// row when the agent shows it.
    mutating func append(pending prompt: PendingPrompt) {
        let id = Self.userRowID(prompt.id, clientRequestId: prompt.id)
        guard !rows.contains(where: { $0.id == id }) else { return }
        closeTurn()
        append(.pending(prompt), id: id)
    }

    /// The person's message by the request that sent it, which the prompt, the live run and the
    /// transcript all carry; by its item id when it came from elsewhere.
    static func userRowID(_ id: String, clientRequestId: String?) -> String {
        clientRequestId.map { "c:" + $0 } ?? id
    }

    /// Closes what is still open: a live run's last stretch stays live and its answer gets no line
    /// beneath it yet.
    mutating func close(live: Bool) {
        fold?.isLive = live
        closeFold()
        if !live { closeAnswer() }
        guard !isGrouped else { return }
        isGrouped = true
        rows = WorkGroups.grouping(rows, from: continues ? 1 : 0, startedAt: segmentStarts)
    }

    private mutating func addBlock(id: String, kind: BlockKind, text: String, nested: Bool, open: Bool, at: Int64?) {
        guard !nested else { return }
        if kind == .thinking {
            addWork(.thinking(ThinkingWork(id: id, text: text, isOpen: open)), at: at)
            return
        }
        let blocks = format(text, open)
        guard !blocks.isEmpty else { return }
        if let at, fold?.endedAt == nil || fold?.endedAt == fold?.startedAt {
            fold?.endedAt = at
        }
        closeFold()
        opening("\(id)/\(blocks[0].key)")
        for (index, block) in blocks.enumerated() {
            let next = index + 1 < blocks.count ? blocks[index + 1].containers.map(\.id) : []
            let piece = TextPiece(
                blockId: id, block: block, kind: kind, isStreaming: open && index == blocks.count - 1, isFirst: index == 0, next: next)
            append(.text(piece), id: "\(id)/\(block.key)")
        }
        turnHasText = true
        answer.append(text)
        answerAt = at ?? answerAt
        lastAt = at ?? lastAt
    }

    private mutating func addWork(_ entry: WorkEntry, at: Int64?) {
        if fold == nil {
            fold = WorkFold(id: "work-\(entry.id)", entries: [], startedAt: lastAt ?? at, isContinuation: turnHasText)
            toolsInFold = [:]
            opening("work-\(entry.id)")
        }
        answer = []
        answerAt = nil
        if case .tool(let tool) = entry { toolsInFold[tool.id] = fold?.entries.count }
        fold?.entries.append(entry)
        if let at { fold?.endedAt = at }
        lastAt = at ?? lastAt
    }

    private mutating func finishTool(_ result: ToolResultItem) {
        lastAt = result.at ?? lastAt
        if case .links(let found) = result.result.display {
            for item in found.items where !sources.contains(where: { $0.url == item.url }) { sources.append(item) }
        }
        if let index = toolsInFold[result.toolCallId], case .tool(var tool) = fold?.entries[index] {
            tool.finish(with: result)
            fold?.entries[index] = .tool(tool)
            if let at = result.at { fold?.endedAt = at }
            return
        }
        for row in rows.indices.reversed() {
            guard case .work(var earlier) = rows[row].content,
                let index = earlier.entries.firstIndex(where: { $0.id == result.toolCallId }),
                case .tool(var tool) = earlier.entries[index]
            else { continue }
            tool.finish(with: result)
            earlier.entries[index] = .tool(tool)
            rows[row] = ChatRow(id: rows[row].id, content: .work(earlier), gap: rows[row].gap)
            return
        }
    }

    private mutating func closeFold() {
        guard let fold else { return }
        self.fold = nil
        append(.work(fold), id: fold.id)
    }

    private mutating func closeTurn() {
        closeFold()
        closeAnswer()
        turnHasText = false
        sources = []
    }

    private mutating func closeAnswer() {
        guard !answer.isEmpty, let last = rows.last, case .text(let piece) = last.content else {
            answer = []
            return
        }
        append(.answerEnd(AnswerEnd(text: answer.joined(separator: "\n\n"), at: answerAt, sources: sources)), id: "end-\(piece.blockId)")
        answer = []
        answerAt = nil
        sources = []
    }

    /// The first work or text of a stretch notes when the item before it was written, which is when
    /// the stretch began.
    private mutating func opening(_ rowID: String) {
        guard !inSegment else { return }
        inSegment = true
        segmentStarts[rowID] = lastAt
    }

    private mutating func append(_ content: ChatRow.Content, id: String) {
        if content.isBreak { inSegment = false }
        rows.append(ChatRow(id: id, content: content, gap: ChatRow.gap(between: rows.last?.content, and: content)))
    }
}

nonisolated extension ChatRow {
    fileprivate var isAgentText: Bool {
        if case .text = content { true } else { false }
    }

    /// The rhythm of the page: messages apart, an answer's blocks spaced by the formatter itself.
    static func gap(between previous: Content?, and next: Content) -> CGFloat {
        guard let previous else { return 0 }
        switch (previous, next) {
        case (_, .user), (_, .pending): return 28
        case (.text(let before), .text(let after)) where before.blockId == after.blockId: return 0
        case (_, .answerEnd): return 6
        case (.work, .work), (.group, .work): return 2
        case (.activity, .activity): return 2
        case (.work, .activity), (.activity, .work): return 2
        case (.user, _), (.pending, _): return 18
        case (.work, .text), (.group, .text): return 10
        default: return 14
        }
    }
}
