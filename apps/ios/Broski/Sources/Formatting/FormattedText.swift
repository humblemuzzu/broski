import BroskiCore
import SwiftUI

/// Agent-authored markdown, formatted by the core (`formatMarkdown`) and drawn block by block. Every
/// string an agent wrote is drawn through this view, `FormatBlockView`, `FormattedMessage` or a
/// tool view built on the core's output, never a bare `Text`.
struct FormattedText: View {
    let text: String
    var role: FormatRole = .page
    /// More text is coming: markup still open at the end is closed rather than shown as written.
    var streaming = false
    /// Blocks drawn; the rest is for a screen of its own (`exceeds`).
    var limit: Int?
    /// Long-pressing offers Copy, Copy as plain text, Select Text and Share.
    var menu = true

    var body: some View {
        let blocks = FormatCache.shared.blocks(text, streaming: streaming)
        let shown = limit.map { Array(blocks.prefix($0)) } ?? blocks
        FormatBlockList(blocks: shown, role: role, streaming: streaming)
            .answerMenu(menu ? text : nil)
    }

    /// Whether `text` has more blocks than `limit` draws.
    static func exceeds(_ text: String, limit: Int) -> Bool {
        FormatCache.shared.blocks(text, streaming: false).count > limit
    }
}

/// The person's own message or a notice: inline styles and fenced code, every other line exactly as
/// typed (`formatMessage`).
struct FormattedMessage: View {
    let text: String
    var role: FormatRole = .page

    var body: some View {
        FormatBlockList(blocks: FormatCache.shared.message(text), role: role, streaming: false)
    }
}

/// Blocks in order, each told the containers of the one after it.
struct FormatBlockList: View {
    let blocks: [FormatBlock]
    let role: FormatRole
    let streaming: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(blocks.indices, id: \.self) { index in
                let block = blocks[index]
                let next = index + 1 < blocks.count ? blocks[index + 1].containers.map(\.id) : []
                FormatBlockView(block: block, role: role, next: next, streaming: streaming && index == blocks.count - 1)
                    .equatable()
                    .id(block.key)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Formatted blocks kept by text, so a finished text is parsed once however often it is drawn and a
/// streaming one once per batch.
@MainActor
final class FormatCache {
    static let shared = FormatCache()

    private struct Key: Hashable {
        let text: String
        let streaming: Bool
        let message: Bool
    }

    /// Finished texts, kept until 2,000 of them or 16 MiB of text; a streaming text is kept only
    /// among the last few, since each batch makes a new one that is never asked for again.
    private var finished: [Key: [FormatBlock]] = [:]
    private var finishedBytes = 0
    private var streaming: [Key: [FormatBlock]] = [:]
    private let finishedCapacity = 2_000
    private let finishedByteBudget = 16 << 20
    private let streamingCapacity = 16

    func blocks(_ text: String, streaming: Bool) -> [FormatBlock] {
        cached(Key(text: text, streaming: streaming, message: false)) { formatMarkdown(text: text, streaming: streaming) }
    }

    func message(_ text: String) -> [FormatBlock] {
        cached(Key(text: text, streaming: false, message: true)) { formatMessage(text: text) }
    }

    private func cached(_ key: Key, parse: () -> [FormatBlock]) -> [FormatBlock] {
        if let known = key.streaming ? streaming[key] : finished[key] { return known }
        let blocks = parse()
        if key.streaming {
            if streaming.count >= streamingCapacity { streaming.removeAll(keepingCapacity: true) }
            streaming[key] = blocks
        } else {
            if finished.count >= finishedCapacity || finishedBytes >= finishedByteBudget {
                finished.removeAll(keepingCapacity: true)
                finishedBytes = 0
            }
            finished[key] = blocks
            finishedBytes += key.text.utf8.count
        }
        return blocks
    }
}
