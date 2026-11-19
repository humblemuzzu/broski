import BroskiCore
import SwiftUI

/// An active `@file` mention at the end of the draft: its range (including `@`) and the query
/// typed after `@`.
nonisolated struct FileMention: Equatable {
    let range: Range<String.Index>
    let query: String
}

/// How the composer searches the current project's files on the Mac (`fs.search`).
struct FileSearchSource {
    let root: String
    let search: @Sendable (String) async -> [String]
}

extension ComposerDraft {
    /// Active `@query` token at the end of `text`, or `nil` when not mentioning a file (or when a
    /// `/` command query is active). Rejects email look-alikes like `a@b.com`.
    var fileMention: FileMention? {
        guard commandQuery == nil, !text.isEmpty else { return nil }
        var index = text.endIndex
        while index > text.startIndex {
            let prev = text.index(before: index)
            let ch = text[prev]
            if ch.isWhitespace { return nil }
            if ch == "@" {
                if prev > text.startIndex {
                    let before = text[text.index(before: prev)]
                    guard before.isWhitespace || Self.mentionDelimiters.contains(before) else { return nil }
                }
                let query = String(text[index..<text.endIndex])
                return FileMention(range: prev..<text.endIndex, query: query)
            }
            index = prev
        }
        return nil
    }

    /// Replaces the active `@query` with `@path ` (quoted if `path` contains whitespace).
    mutating func pickFile(_ path: String) {
        guard let mention = fileMention else { return }
        let formatted = path.contains(where: \.isWhitespace) ? "@\"\(path)\" " : "@\(path) "
        text.replaceSubrange(mention.range, with: formatted)
    }

    private static let mentionDelimiters: Set<Character> = ["(", "[", "{", "\"", "'"]
}

/// Small per-composer LRU cache of recent `fs.search` answers so backspacing is instant.
@MainActor
final class FileMentionCache {
    private struct Key: Hashable {
        let root: String
        let query: String
    }

    private var entries: [Key: [String]] = [:]
    private var order: [Key] = []
    private let capacity = 32

    func get(root: String, query: String) -> [String]? {
        let key = Key(root: root, query: query)
        guard let found = entries[key] else { return nil }
        touch(key)
        return found
    }

    func put(root: String, query: String, paths: [String]) {
        let key = Key(root: root, query: query)
        entries[key] = paths
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
