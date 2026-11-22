import BroskiCore
import SwiftUI
import UniformTypeIdentifiers

/// A table drawn open, without a card: the header in the secondary colour, a hairline above and
/// below it and under every row, cells top-aligned and numbers right-aligned in tabular digits. At
/// the top level of an answer its lines run to the screen's edges and its first column's text is
/// in line with the prose (`bleed`). Its columns fit the width as `TableLayout` decides; past twelve
/// rows it shows ten and a button for the rest; Expand opens it whole; a long-press copies it as TSV
/// and HTML at once, so a paste into Notes keeps it a table.
struct FormatTableView: View {
    let table: FormatTable
    let streaming: Bool
    var bleed: CGFloat = 0
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.reading) private var reading
    @Environment(\.formatContext) private var context
    @Environment(AppModel.self) private var app: AppModel?
    @Environment(Disclosure.self) private var disclosure: Disclosure?
    @Environment(\.disclosureKey) private var disclosureKey
    @Environment(\.formatWidthHint) private var widthHint
    @State private var width: CGFloat?
    @State private var grown: [CGFloat] = []
    @State private var showsAllHere = false

    /// Kept by the chat in a transcript row, which a reused cell would otherwise fold again.
    private var showsAll: Bool {
        if let disclosure, let disclosureKey { disclosure.isOpen(disclosureKey + "/rows") } else { showsAllHere }
    }

    private func toggleShowsAll() {
        if let disclosure, let disclosureKey { disclosure.toggle(disclosureKey + "/rows") } else { showsAllHere.toggle() }
    }

    private var shownRows: Int {
        table.rows.count > FormatTokens.tableFoldRows && !showsAll ? FormatTokens.tableShownRows : table.rows.count
    }

    var body: some View {
        let layout = currentLayout
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .frame(height: 0)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                TableGrid(table: table, layout: layout, rows: shownRows, style: spanStyle, edge: bleed)
                    .frame(minWidth: 0, maxWidth: width ?? .infinity, alignment: .leading)
                    .contextMenu { TableMenuItems(table: table) }
                footer
            }
        }
        .onChange(of: layout.widths) { _, widths in
            if streaming { grown = widths }
        }
    }

    private var currentLayout: TableLayout {
        let fonts = TableFonts(typeSize: typeSize)
        var layout = TableLayoutCache.fit(table, width: width ?? widthHint ?? 360, fonts: fonts, rows: shownRows)
        if streaming, grown.count == layout.widths.count {
            layout.widths = zip(layout.widths, grown).map { max($0, $1) }
        }
        return layout
    }

    private var spanStyle: SpanStyle {
        var style = TableFonts(typeSize: typeSize).spanStyle(underlinesLinks: reading.underlinesLinks)
        style.opensFiles = context != nil
        return style
    }

    private var footer: some View {
        HStack(spacing: Spacing.m) {
            if table.rows.count > FormatTokens.tableFoldRows {
                Button(showsAll ? "Show fewer rows" : "Show all \(table.rows.count) rows") {
                    withAnimation(.easeOut(duration: 0.2)) { toggleShowsAll() }
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(FormatTokens.link)
            }
            Spacer(minLength: 0)
            Button {
                TableViewer.present(table, context: context, app: app)
            } label: {
                Label("Expand table", systemImage: "arrow.up.left.and.arrow.down.right")
                    .labelStyle(.iconOnly)
                    .font(.footnote.weight(.medium))
                    .frame(minWidth: 36, minHeight: 28)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tertiary)
        }
    }
}

/// The table's cells at the layout's widths, scrolling sideways when the layout says so. `edge` is
/// how far past the grid its lines run, and how far a sideways scroll reaches, to the screen's edges;
/// with one, the first column's text starts where the prose does.
struct TableGrid: View {
    let table: FormatTable
    let layout: TableLayout
    let rows: Int
    let style: SpanStyle
    var edge: CGFloat = 0

    @State private var moreToTheRight = false

    var body: some View {
        let all = Array(table.columns.indices)
        if !layout.scrolls {
            TableColumns(table: table, columns: all, spoken: all, layout: layout, rows: rows, style: style, lines: (edge, edge))
        } else if layout.stickyFirstColumn {
            HStack(alignment: .top, spacing: 0) {
                TableColumns(table: table, columns: [0], spoken: [], layout: layout, rows: rows, style: style, lines: (edge, 0))
                    .overlay(alignment: .trailing) { Rectangle().fill(FormatTokens.hairline).frame(width: 0.5) }
                scrolling(Array(all.dropFirst()), spoken: all, leading: 0)
            }
        } else {
            scrolling(all, spoken: all, leading: edge)
        }
    }

    /// Columns that scroll sideways to the screen's edge, their trailing edge fading while more of the
    /// table is to the right, so a cut column never reads as the table's end.
    private func scrolling(_ columns: [Int], spoken: [Int], leading: CGFloat) -> some View {
        ScrollView(.horizontal) {
            TableColumns(table: table, columns: columns, spoken: spoken, layout: layout, rows: rows, style: style, lines: (leading, edge))
        }
        .contentMargins(.leading, leading, for: .scrollContent)
        .contentMargins(.trailing, edge, for: .scrollContent)
        .scrollIndicatorsFlash(onAppear: true)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.x + geometry.containerSize.width < geometry.contentSize.width - 1
        } action: { _, more in
            moreToTheRight = more
        }
        .mask {
            HStack(spacing: 0) {
                Rectangle()
                LinearGradient(colors: [.black, .black.opacity(0.15)], startPoint: .leading, endPoint: .trailing)
                    .frame(width: moreToTheRight ? FormatTokens.tableEdgeFade : 0)
            }
        }
        .padding(.leading, -leading)
        .padding(.trailing, -edge)
    }
}

/// Some of a table's columns, header first, as wide as those columns together, with a hairline
/// above the header and under every row that runs `lines` further on each side. Each row is one
/// accessibility element reading the `spoken` columns; with none, the row is left to the part of the
/// table that reads it whole.
private struct TableColumns: View {
    let table: FormatTable
    let columns: [Int]
    let spoken: [Int]
    let layout: TableLayout
    let rows: Int
    let style: SpanStyle
    let lines: (leading: CGFloat, trailing: CGFloat)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            line
            row(table.header, index: 0, header: true)
                .accessibilityAddTraits(.isHeader)
            line
            ForEach(0..<min(rows, table.rows.count), id: \.self) { index in
                row(table.rows[index], index: index + 1, header: false)
                line
            }
        }
        .frame(width: columns.reduce(0) { $0 + layout.widths[$1] }, alignment: .leading)
    }

    private var line: some View {
        Rectangle()
            .fill(FormatTokens.hairline)
            .frame(height: 0.5)
            .padding(.leading, -lines.leading)
            .padding(.trailing, -lines.trailing)
            .accessibilityHidden(true)
    }

    private func row(_ cells: [TableCell], index: Int, header: Bool) -> some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(columns, id: \.self) { column in
                TableCellView(cell: cells[column], column: table.columns[column], header: header, style: style, flush: column == 0 && lines.leading > 0)
                    .frame(width: layout.widths[column], alignment: alignment(column))
                    .frame(height: index < layout.rowHeights.count ? layout.rowHeights[index] : nil, alignment: .top)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken(cells, index: index, header: header))
        .accessibilityHidden(spoken.isEmpty)
    }

    private func alignment(_ column: Int) -> Alignment {
        switch table.columns[column].align {
        case .center: .top
        case .end: .topTrailing
        case .auto where table.columns[column].numeric: .topTrailing
        case .start, .auto: .topLeading
        }
    }

    /// "Row 2 of 5, Name: …", as VoiceOver reads a row.
    private func spoken(_ cells: [TableCell], index: Int, header: Bool) -> String {
        let values = spoken.map { TableLayout.plain(cells[$0].spans) }
        if header { return "Columns: " + values.joined(separator: ", ") }
        let named = zip(spoken.map { TableLayout.plain(table.header[$0].spans) }, values).map { "\($0): \($1)" }
        return "Row \(index) of \(table.rows.count), " + named.joined(separator: ", ")
    }
}

/// One cell; a header cell in the secondary colour, a little heavier, so the eye goes to the rows.
struct TableCellView: View {
    let cell: TableCell
    let column: BroskiCore.TableColumn
    let header: Bool
    let style: SpanStyle
    var size: CGFloat?
    /// The first column of a table that reaches the screen's edges: its text starts where the prose does.
    var flush = false

    var body: some View {
        FormatSpans.text(cell.spans, style: header ? headerStyle : style)
            .font(font)
            .foregroundStyle(header ? .secondary : .primary)
            .monospacedDigit()
            .multilineTextAlignment(textAlignment)
            .tint(FormatTokens.link)
            .textRenderer(ChipRenderer())
            .fixedSize(horizontal: false, vertical: true)
            .padding(FormatTokens.tableCellPadding)
            .padding(.leading, flush ? -FormatTokens.tableCellPadding.leading : 0)
    }

    private var headerStyle: SpanStyle {
        var bold = style
        bold.font = bold.font.weight(.semibold)
        return bold
    }

    private var font: Font {
        let weight: Font.Weight = header ? .semibold : .regular
        return size.map { .system(size: $0, weight: weight) } ?? .subheadline.weight(weight)
    }

    private var textAlignment: TextAlignment {
        switch column.align {
        case .center: .center
        case .end: .trailing
        case .auto where column.numeric: .trailing
        case .start, .auto: .leading
        }
    }
}

/// Copy as TSV and HTML together, or as Markdown or CSV; Share; Expand.
struct TableMenuItems: View {
    let table: FormatTable
    @Environment(\.formatContext) private var context
    @Environment(AppModel.self) private var app: AppModel?

    var body: some View {
        Button("Copy Table", systemImage: "tablecells") {
            UIPasteboard.general.setItems([[UTType.plainText.identifier: tableTsv(table: table), UTType.html.identifier: tableHtml(table: table)]])
        }
        Button("Copy as Markdown", systemImage: "number") { UIPasteboard.general.string = tableMarkdown(table: table) }
        Button("Copy as CSV", systemImage: "list.bullet.rectangle") { UIPasteboard.general.string = tableCsv(table: table) }
        Button("Expand", systemImage: "arrow.up.left.and.arrow.down.right") {
            TableViewer.present(table, context: context, app: app)
        }
        ShareLink(item: tableMarkdown(table: table))
    }
}
