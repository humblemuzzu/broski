import BroskiCore
import SwiftUI

/// An active `@file` mention at the cursor: its range (including `@`) and the query after `@`.
nonisolated struct FileMention: Equatable {
    let range: Range<String.Index>
    let query: String
}

/// How the composer searches the current project's files on the Mac (`fs.search`).
/// Returns `nil` when the search failed so transient errors are never cached as empty.
struct FileSearchSource {
    let root: String
    let search: @Sendable (String) async -> [String]?
}

extension ComposerDraft {
    /// Active `@query` token ending at `cursorUtf16` (or the end of `text` when `nil`), or `nil`
    /// when not mentioning a file or when a `/` command query is active. Rejects emails (`a@b.com`).
    func fileMention(at cursorUtf16: Int? = nil) -> FileMention? {
        guard commandQuery == nil, !text.isEmpty else { return nil }
        let end = Self.index(in: text, utf16Offset: cursorUtf16)
        guard end > text.startIndex else { return nil }
        var index = end
        while index > text.startIndex {
            let prev = text.index(before: index)
            let ch = text[prev]
            if ch.isWhitespace { return nil }
            if ch == "@" {
                if prev > text.startIndex {
                    let before = text[text.index(before: prev)]
                    guard before.isWhitespace || Self.mentionDelimiters.contains(before) else { return nil }
                }
                let query = String(text[index..<end])
                return FileMention(range: prev..<end, query: query)
            }
            index = prev
        }
        return nil
    }

    /// Replaces the active `@query` at `cursorUtf16` with `@path ` (quoted if `path` has whitespace)
    /// and returns the new UTF-16 cursor offset right after the inserted mention.
    @discardableResult
    mutating func pickFile(_ path: String, at cursorUtf16: Int? = nil) -> Int? {
        guard let mention = fileMention(at: cursorUtf16) else { return nil }
        let needsTrailingSpace = mention.range.upperBound == text.endIndex
            || !text[mention.range.upperBound].isWhitespace
        let base = path.contains(where: \.isWhitespace) ? "@\"\(path)\"" : "@\(path)"
        let replacement = needsTrailingSpace ? base + " " : base
        let prefixUtf16 = text[..<mention.range.lowerBound].utf16.count
        text.replaceSubrange(mention.range, with: replacement)
        return prefixUtf16 + replacement.utf16.count
    }

    private static func index(in text: String, utf16Offset: Int?) -> String.Index {
        guard let utf16Offset else { return text.endIndex }
        let clamped = min(max(utf16Offset, 0), text.utf16.count)
        let u16 = text.utf16.index(text.utf16.startIndex, offsetBy: clamped)
        if let pos = u16.samePosition(in: text) { return pos }
        return text.utf16.index(before: u16).samePosition(in: text) ?? text.endIndex
    }

    private static let mentionDelimiters: Set<Character> = ["(", "[", "{", "\"", "'"]
}

/// Small per-composer LRU cache with a 30 s TTL so backspacing is instant while newly created files
/// still appear shortly after an agent writes them. Failed searches are never cached.
@MainActor
final class FileMentionCache {
    private struct Key: Hashable {
        let root: String
        let query: String
    }

    private struct Entry {
        let paths: [String]
        let storedAt: Date
    }

    private var entries: [Key: Entry] = [:]
    private var order: [Key] = []
    private let capacity = 32
    private let ttl: TimeInterval

    init(ttl: TimeInterval = 30) {
        self.ttl = ttl
    }

    func get(root: String, query: String, now: Date = .now) -> [String]? {
        let key = Key(root: root, query: query)
        guard let found = entries[key] else { return nil }
        if now.timeIntervalSince(found.storedAt) > ttl {
            entries.removeValue(forKey: key)
            if let idx = order.firstIndex(of: key) { order.remove(at: idx) }
            return nil
        }
        touch(key)
        return found.paths
    }

    func put(root: String, query: String, paths: [String], now: Date = .now) {
        let key = Key(root: root, query: query)
        entries[key] = Entry(paths: paths, storedAt: now)
        touch(key)
        while order.count > capacity {
            entries.removeValue(forKey: order.removeFirst())
        }
    }

    private func touch(_ key: Key) {
        if let idx = order.firstIndex(of: key) { order.remove(at: idx) }
        order.append(key)
    }
}

/// Matching project files shown above the composer while typing `@…`.
struct FileMentionList: View {
    let paths: [String]
    let pick: (String) -> Void

    static let height: CGFloat = 200

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(paths, id: \.self) { path in
                    Button { pick(path) } label: { row(path) }
                        .buttonStyle(.plain)
                }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: Self.height)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func row(_ path: String) -> some View {
        let isFolder = path.hasSuffix("/")
        let trimmed = isFolder ? String(path.dropLast()) : path
        let name = trimmed.split(separator: "/").last.map(String.init) ?? trimmed
        let parent: String? = if let slash = trimmed.lastIndex(of: "/") {
            String(trimmed[..<slash])
        } else {
            nil
        }
        return HStack(spacing: Spacing.s) {
            Image(systemName: isFolder ? "folder" : "doc.text")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(width: 18)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(isFolder ? name + "/" : name)
                    .font(.code.weight(.medium))
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let parent {
                    Text(parent)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.head)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Spacing.s)
        .padding(.horizontal, Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}
