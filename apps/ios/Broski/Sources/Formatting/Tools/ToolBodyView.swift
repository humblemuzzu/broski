import BroskiCore
import SwiftUI

/// A tool's result as the core reads it (`toolBody`, or the adapter's own display): markdown
/// formatted, a file's numbered lines, search rows that open their files, JSON coloured, or a log
/// with its links found. Everything a tool printed is drawn here or by the formatter, never raw.
struct ToolBodyView: View {
    let body_: ToolBody
    let title: String

    init(_ body: ToolBody, title: String) {
        body_ = body
        self.title = title
    }

    /// Blocks of a report drawn in place; the rest opens on a page of its own.
    static let reportBlocks = 6

    var body: some View {
        switch body_ {
        case .empty:
            EmptyView()
        case .markdown(let text):
            ReportBody(text: text, title: title)
        case .fileText(let path, let language, let firstLine, let text):
            FileTextBody(path: path, language: language, firstLine: Int(firstLine), text: text, note: nil)
        case .matches(let rows, let hiddenRows):
            MatchRowsView(rows: rows, hiddenRows: Int(hiddenRows))
        case .json(let lines):
            CodeLinesBox(lines: lines)
        case .log(let lines, let hiddenLines):
            LogBox(log: LogText(lines: lines, hiddenLines: hiddenLines), title: title, source: nil)
        }
    }
}

/// A report or a fetched page: its first blocks formatted, the whole a tap away.
struct ReportBody: View {
    let text: String
    let title: String
    @Environment(\.formatContext) private var context

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            FormattedText(text: text, role: .quiet, limit: ToolBodyView.reportBlocks)
            if FormattedText.exceeds(text, limit: ToolBodyView.reportBlocks) {
                NavigationLink(value: Route.text(TextPage(title: title, text: text, format: .markdown, context: context))) {
                    Label("Open full report", systemImage: "doc.text")
                        .font(.footnote.weight(.semibold))
                }
            }
        }
    }
}

/// Lines of a file from the line they start at, coloured by the file's language; the first ones in
/// place, the file itself in Files.
struct FileTextBody: View {
    let path: String
    let language: String?
    let firstLine: Int
    let text: String
    let note: String?
    @Environment(\.formatContext) private var context
    @State private var coloured: [CodeLine]?

    private static let shownLines = 24

    var body: some View {
        let plain = Highlighter.plainLines(text.hasSuffix("\n") ? String(text.dropLast()) : text)
        let lines = coloured ?? plain
        VStack(alignment: .leading, spacing: Spacing.xs) {
            NumberedCode(lines: Array(lines.prefix(Self.shownLines)), firstLine: firstLine)
                .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
            HStack(spacing: Spacing.s) {
                if let note { Text(note).font(.caption).foregroundStyle(.secondary) }
                if lines.count > Self.shownLines {
                    Text("^[\(lines.count - Self.shownLines) more line](inflect: true)").font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if let context {
                    NavigationLink(value: Route.workspace(machineId: context.machineId, place: .file(context.resolve(path), line: firstLine))) {
                        Label("Open in Files", systemImage: "doc.text.magnifyingglass").font(.footnote.weight(.semibold))
                    }
                }
            }
        }
        .task(id: text) {
            guard let language = language ?? languageForPath(path: path) else { return }
            coloured = await Highlighter.shared.highlight(text, language: language)
        }
    }
}

/// Code lines with their numbers in a gutter, scrolling sideways together.
struct NumberedCode: View {
    let lines: [CodeLine]
    let firstLine: Int

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: Spacing.m) {
                VStack(alignment: .trailing, spacing: 0) {
                    ForEach(lines.indices, id: \.self) { index in
                        Text(String(firstLine + index)).foregroundStyle(.tertiary)
                    }
                }
                .accessibilityHidden(true)
                Text(joined)
                    .fixedSize(horizontal: true, vertical: false)
                    .textSelection(.enabled)
            }
            .font(.codeSmall)
            .padding(Spacing.s)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
    }

    private var joined: AttributedString {
        var text = AttributedString()
        for (index, line) in lines.enumerated() {
            if index > 0 { text += AttributedString("\n") }
            text += line.attributed
        }
        return text
    }
}

/// Coloured code lines (pretty-printed JSON) in a capped box that scrolls.
struct CodeLinesBox: View {
    let lines: [CodeLine]

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            Text(lines.reduce(into: AttributedString()) { text, line in
                if !text.characters.isEmpty { text += AttributedString("\n") }
                text += line.attributed
            })
            .font(.codeSmall)
            .fixedSize()
            .textSelection(.enabled)
            .padding(Spacing.s)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: ToolDetailView.outputCap)
        .fixedSize(horizontal: false, vertical: true)
        .background(Palette.codeBackground, in: .rect(cornerRadius: Radius.small, style: .continuous))
    }
}

/// Search results: a row per file, or per matching line, opening the file at it.
struct MatchRowsView: View {
    let rows: [MatchRow]
    let hiddenRows: Int
    @Environment(\.formatContext) private var context

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ForEach(rows.indices, id: \.self) { index in
                let row = rows[index]
                if let context {
                    NavigationLink(value: Route.workspace(machineId: context.machineId, place: .file(context.resolve(row.path), line: row.line.map { Int($0) }))) {
                        MatchRowLine(row: row)
                    }
                    .buttonStyle(.plain)
                } else {
                    MatchRowLine(row: row)
                }
            }
            if hiddenRows > 0 {
                Text("^[\(hiddenRows) more match](inflect: true)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

private struct MatchRowLine: View {
    let row: MatchRow

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xxs) {
            HStack(spacing: Spacing.xs) {
                Text(row.path).font(.footnote.weight(.medium)).foregroundStyle(FormatTokens.path).lineLimit(1).truncationMode(.head)
                if let line = row.line { Text(":\(line)").font(.footnote.monospacedDigit()).foregroundStyle(.secondary) }
            }
            if !row.segments.isEmpty {
                Text(row.segments.reduce(into: AttributedString()) { text, segment in
                    var piece = AttributedString(segment.text)
                    if segment.matched {
                        piece.backgroundColor = Palette.caution.opacity(0.25)
                        piece.font = .codeSmall.weight(.semibold)
                    }
                    text += piece
                })
                .font(.codeSmall)
                .lineLimit(2)
            }
        }
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}
