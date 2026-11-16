import BroskiCore
import SwiftUI
import UIKit

/// A long text a row only shows a clip of (a log, a tool's output, a report), opened whole.
struct TextPage: Hashable {
    enum Format: Hashable {
        case markdown
        case plain
        /// Monospaced output whose newest lines matter: it opens at its end.
        case log
    }

    let title: String
    let text: String
    let format: Format
}

extension TextPage.Format {
    init(_ format: ActivityFormat) {
        switch format {
        case .markdown: self = .markdown
        case .text: self = .plain
        case .log: self = .log
        }
    }
}

/// The whole text on a screen of its own, drawn line by line as it scrolls into view, with a copy
/// button in the bar.
struct TextPageScreen: View {
    let page: TextPage
    private let lines: [String]
    private let blocks: [MarkdownBlock]
    @State private var copied = 0

    init(page: TextPage) {
        self.page = page
        if page.format == .markdown {
            lines = []
            blocks = markdownBlocks(text: page.text)
        } else {
            lines = page.text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            blocks = []
        }
    }

    var body: some View {
        ScrollView {
            content
                .padding(.horizontal, Spacing.l + Spacing.xs)
                .padding(.vertical, Spacing.m)
        }
        .defaultScrollAnchor(page.format == .log ? .bottom : .top, for: .initialOffset)
        .navigationTitle(page.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    UIPasteboard.general.string = page.text
                    copied += 1
                } label: {
                    Image(systemName: copied > 0 ? "checkmark" : "doc.on.doc")
                        .contentTransition(.symbolEffect(.replace))
                }
                .accessibilityLabel("Copy")
            }
        }
        .haptic(.confirmed, trigger: copied)
    }

    @ViewBuilder
    private var content: some View {
        if page.format == .markdown {
            LazyVStack(alignment: .leading, spacing: Spacing.m) {
                ForEach(blocks, id: \.key) { block in
                    MarkdownBlockView(
                        piece: TextPiece(blockId: "page", block: block, kind: .text, isStreaming: false, isFirst: false))
                }
            }
        } else {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(lines.indices, id: \.self) { index in
                    Text(lines[index].isEmpty ? " " : lines[index])
                        .font(page.format == .log ? .codeSmall : .body)
                        .foregroundStyle(page.format == .log ? .secondary : .primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }
        }
    }
}
