import BroskiCore

/// The core's markdown blocks of each text block, parsed once per text: a finished block never
/// changes, so only the open block is parsed again as it streams (rendering.md, "Keys").
final class MarkdownCache {
    private var parsed: [String: (text: String, blocks: [MarkdownBlock])] = [:]
    private let capacity = 4_000

    func blocks(_ blockId: String, _ text: String) -> [MarkdownBlock] {
        if let known = parsed[blockId], known.text == text { return known.blocks }
        if parsed.count >= capacity { parsed.removeAll(keepingCapacity: true) }
        let blocks = markdownBlocks(text: text)
        parsed[blockId] = (text, blocks)
        return blocks
    }
}
