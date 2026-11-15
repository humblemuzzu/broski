import BroskiCore
import SwiftUI

/// One markdown block of the agent's text (rendering.md, "Markdown"): its quotes and list items as
/// indents, bars and markers, then the block itself. Equatable, so a finished block is never drawn
/// again while the open one streams below it.
struct MarkdownBlockView: View, Equatable {
    let piece: TextPiece
    @ScaledMetric(relativeTo: .body) private var indent: CGFloat = 22

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(Array(piece.block.containers.enumerated()), id: \.offset) { _, container in
                column(container)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    nonisolated static func == (lhs: MarkdownBlockView, rhs: MarkdownBlockView) -> Bool {
        lhs.piece == rhs.piece
    }

    @ViewBuilder
    private func column(_ container: BlockContainer) -> some View {
        switch container {
        case .quote:
            RoundedRectangle(cornerRadius: 1.5)
                .fill(.quaternary)
                .frame(width: 3)
                .frame(maxHeight: .infinity)
                .padding(.trailing, Spacing.m)
        case .listItem(let marker, let first):
            Group {
                if first { ListMarkerView(marker: marker) }
            }
            .frame(width: indent, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch piece.block.content {
        case .paragraph(let runs):
            Text(InlineText.attributed(runs))
                .font(.body)
                .lineSpacing(5)
                .textSelection(.enabled)
        case .heading(let level, let runs):
            Text(InlineText.attributed(runs))
                .font(.heading(level))
                .textSelection(.enabled)
                .accessibilityAddTraits(.isHeader)
        case .code(let language, let text):
            CodeBlockView(code: text, language: language, isComplete: !piece.isStreaming)
        case .table(let alignments, let header, let rows):
            MarkdownTable(alignments: alignments, header: header, rows: rows)
        case .rule:
            Divider().padding(.vertical, Spacing.xs)
        case .html(let text):
            Text(text)
                .font(.codeSmall)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }
}

private struct ListMarkerView: View {
    let marker: ListMarker

    var body: some View {
        switch marker {
        case .bullet:
            Text("•").font(.body).foregroundStyle(.secondary)
        case .number(let value):
            Text("\(value).").font(.body.monospacedDigit()).foregroundStyle(.secondary)
        case .task(let checked):
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .font(.subheadline)
                .foregroundStyle(checked ? Palette.accent : .secondary)
                .accessibilityLabel(checked ? "Done" : "Not done")
        }
    }
}

/// A table that scrolls sideways rather than squeezing its columns.
private struct MarkdownTable: View {
    let alignments: [ColumnAlignment]
    let header: BroskiCore.TableRow
    let rows: [BroskiCore.TableRow]

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: Spacing.l, verticalSpacing: Spacing.s) {
                row(header).fontWeight(.semibold)
                Divider()
                ForEach(rows.indices, id: \.self) { index in
                    row(rows[index])
                }
            }
            .font(.subheadline)
            .padding(.vertical, Spacing.xs)
        }
        .scrollIndicators(.hidden)
    }

    private func row(_ row: BroskiCore.TableRow) -> some View {
        GridRow {
            ForEach(row.cells.indices, id: \.self) { index in
                Text(InlineText.attributed(row.cells[index].runs))
                    .gridColumnAlignment(alignment(index))
                    .textSelection(.enabled)
            }
        }
    }

    private func alignment(_ column: Int) -> HorizontalAlignment {
        switch alignments.indices.contains(column) ? alignments[column] : .leading {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
    }
}

/// Inline runs as styled text: bold, italic, struck and code by presentation intent, so they follow
/// the block's own font and Dynamic Type; links tappable in the accent colour.
enum InlineText {
    static func attributed(_ runs: [InlineRun]) -> AttributedString {
        var text = AttributedString()
        for run in runs {
            var piece = AttributedString(run.text)
            var intent: InlinePresentationIntent = []
            if run.strong { intent.insert(.stronglyEmphasized) }
            if run.emphasis { intent.insert(.emphasized) }
            if run.strikethrough { intent.insert(.strikethrough) }
            if run.code {
                intent.insert(.code)
                piece.backgroundColor = Color(uiColor: .tertiarySystemFill)
            }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            if let link = run.link, let url = URL(string: link) {
                piece.link = url
                piece.foregroundColor = Palette.accent
            }
            text += piece
        }
        return text
    }
}

extension Font {
    /// A markdown heading: levels 1 and 2 stand out, the rest stay close to the prose.
    static func heading(_ level: UInt8) -> Font {
        switch level {
        case 1: .title3.weight(.bold)
        case 2: .headline
        default: .subheadline.weight(.semibold)
        }
    }
}
