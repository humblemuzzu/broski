import BroskiCore
import SwiftUI

/// Where agent-authored text is drawn, which sets its size and emphasis: `page` for the answer the
/// person reads (the transcript, a plan, a report opened whole), `quiet` for what sits under a row
/// (thinking, a subagent's or an activity's text).
nonisolated enum FormatRole: Equatable {
    case page
    case quiet

    var font: Font {
        switch self {
        case .page: .body
        case .quiet: .subheadline
        }
    }

    var style: HierarchicalShapeStyle {
        switch self {
        case .page: .primary
        case .quiet: .secondary
        }
    }

    var lineSpacing: CGFloat {
        switch self {
        case .page: 5
        case .quiet: 3
        }
    }

    @MainActor var blockSpacing: CGFloat {
        switch self {
        case .page: Spacing.m
        case .quiet: Spacing.s
        }
    }
}

/// Agent-authored markdown, formatted by the core (`formatMarkdown`) and drawn block by block. Every
/// string an agent wrote is drawn through this view or `FormatBlockView`, never a bare `Text`.
struct FormattedText: View {
    let text: String
    var role: FormatRole = .page
    /// More text is coming: markup still open at the end is closed rather than shown as written.
    var streaming = false
    /// Blocks drawn; the rest is for a screen of its own (`exceeds`).
    var limit: Int?

    var body: some View {
        let blocks = FormatCache.shared.blocks(text, streaming: streaming)
        VStack(alignment: .leading, spacing: role.blockSpacing) {
            ForEach(limit.map { Array(blocks.prefix($0)) } ?? blocks, id: \.key) { block in
                FormatBlockView(block: block, role: role).equatable()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Whether `text` has more blocks than `limit` draws.
    static func exceeds(_ text: String, limit: Int) -> Bool {
        FormatCache.shared.blocks(text, streaming: false).count > limit
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
    }

    private var parsed: [Key: [FormatBlock]] = [:]
    private let capacity = 2_000

    func blocks(_ text: String, streaming: Bool) -> [FormatBlock] {
        let key = Key(text: text, streaming: streaming)
        if let known = parsed[key] { return known }
        if parsed.count >= capacity { parsed.removeAll(keepingCapacity: true) }
        let blocks = formatMarkdown(text: text, streaming: streaming)
        parsed[key] = blocks
        return blocks
    }
}
