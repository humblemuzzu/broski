import BroskiCore
import SwiftUI

/// A table opened whole: it scrolls both ways with its header row and first column held still, a
/// pinch changes its text size, it turns with the phone, copies as Markdown, CSV or TSV, and can be
/// read as rows instead, each a card of `Header: value`.
struct TableViewer: View {
    let table: FormatTable
    @State private var asRows = false
    @State private var zoom: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.dismiss) private var dismiss
    @Environment(\.reading) private var reading

    private var scale: CGFloat { min(max(zoom * pinch, 0.6), 2.2) }
    /// The widest a column grows in the viewer before its cells wrap.
    private static let maxColumn: CGFloat = 320

    var body: some View {
        NavigationStack {
            Group {
                if asRows { rows } else { grid }
            }
            .navigationTitle("\(table.rows.count) × \(table.columns.count) table")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
        }
    }

    private var grid: some View {
        let fonts = TableFonts(typeSize: typeSize, scale: scale)
        let layout = viewerLayout(fonts: fonts)
        let style = fonts.spanStyle(underlinesLinks: reading.underlinesLinks)
        return ScrollView(.vertical) {
            HStack(alignment: .top, spacing: 0) {
                pinnedColumns([0], layout: layout, style: style)
                    .background(Color(uiColor: .systemBackground))
                    .overlay(alignment: .trailing) { Rectangle().fill(FormatTokens.hairline).frame(width: 0.5) }
                ScrollView(.horizontal) {
                    pinnedColumns(Array(table.columns.indices.dropFirst()), layout: layout, style: style)
                }
            }
        }
        .gesture(MagnifyGesture().updating($pinch) { value, state, _ in state = value.magnification }.onEnded { zoom = min(max(zoom * $0.magnification, 0.6), 2.2) })
    }

    /// Columns with the header row pinned to the top while the rows scroll under it.
    private func pinnedColumns(_ columns: [Int], layout: TableLayout, style: SpanStyle) -> some View {
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
            Section {
                ForEach(table.rows.indices, id: \.self) { index in
                    cells(table.rows[index], columns: columns, layout: layout, height: layout.rowHeights[index + 1], header: false, style: style)
                    Rectangle().fill(FormatTokens.hairline).frame(height: 0.5)
                }
            } header: {
                cells(table.header, columns: columns, layout: layout, height: layout.rowHeights[0], header: true, style: style)
                    .background(.bar)
            }
        }
        .frame(width: columns.reduce(0) { $0 + layout.widths[$1] })
    }

    private func cells(_ cells: [TableCell], columns: [Int], layout: TableLayout, height: CGFloat, header: Bool, style: SpanStyle) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(columns, id: \.self) { column in
                TableCellView(cell: cells[column], column: table.columns[column], header: header, style: style, size: style.size)
                    .frame(width: layout.widths[column], height: height, alignment: .topLeading)
            }
        }
    }

    /// Every column at its natural width up to the viewer's cap, every row measured.
    private func viewerLayout(fonts: TableFonts) -> TableLayout {
        let (natural, minimum) = TableLayout.columnWidths(table, fonts: fonts)
        let widths = zip(natural, minimum).map { max(min($0, Self.maxColumn * scale), $1) }
        return TableLayout.measured(table, widths: widths, fonts: fonts)
    }

    private var rows: some View {
        List(table.rows.indices, id: \.self) { index in
            VStack(alignment: .leading, spacing: Spacing.s) {
                ForEach(table.columns.indices, id: \.self) { column in
                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                        Text(TableLayout.plain(table.header[column].spans))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(FormatSpans.attributed(table.rows[index][column].spans, style: SpanStyle(font: .body, codeFont: .system(.callout, design: .monospaced))))
                            .font(.body)
                            .tint(FormatTokens.link)
                    }
                }
            }
            .padding(.vertical, Spacing.xs)
            .accessibilityElement(children: .combine)
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Done") { dismiss() }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button(asRows ? "Table" : "Rows", systemImage: asRows ? "tablecells" : "rectangle.grid.1x2") { asRows.toggle() }
            Menu("Copy", systemImage: "doc.on.doc") {
                Button("Copy as Markdown") { UIPasteboard.general.string = tableMarkdown(table: table) }
                Button("Copy as CSV") { UIPasteboard.general.string = tableCsv(table: table) }
                Button("Copy as TSV") { UIPasteboard.general.string = tableTsv(table: table) }
            }
            ShareLink(item: tableMarkdown(table: table))
        }
    }
}
