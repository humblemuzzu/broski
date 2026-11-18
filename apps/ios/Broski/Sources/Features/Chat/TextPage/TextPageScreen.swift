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
    /// The machine and folder the text belongs to, so its paths open.
    var context: FormatContext?
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

/// The whole text on a screen of its own: markdown formatted block by block, a log or plain text
/// line by line with its links found, each drawn as it scrolls into view; a copy button in the bar.
struct TextPageScreen: View {
    let page: TextPage
    private let lines: [Substring]
    private let blocks: [FormatBlock]
    @State private var copied = 0

    init(page: TextPage) {
        self.page = page
        if page.format == .markdown {
            lines = []
            blocks = FormatCache.shared.blocks(page.text, streaming: false)
        } else {
            lines = page.text.split(separator: "\n", omittingEmptySubsequences: false)
            blocks = []
        }
    }

    var body: some View {
        ScrollView {
            content
                .padding(.horizontal, TranscriptView.sideMargin)
                .padding(.vertical, Spacing.m)
        }
        .environment(\.formatBleed, TranscriptView.sideMargin)
        .defaultScrollAnchor(page.format == .log ? .bottom : .top, for: .initialOffset)
        .environment(\.formatContext, page.context)
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
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(blocks.indices, id: \.self) { index in
                    let next = index + 1 < blocks.count ? blocks[index + 1].containers.map(\.id) : []
                    FormatBlockView(block: blocks[index], next: next).equatable()
                }
            }
            .answerMenu(page.text)
        } else {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(lines.indices, id: \.self) { index in
                    LogLinesView(
                        log: formatLog(text: String(lines[index]), maxLines: 1, keep: .head),
                        tint: page.format == .log ? .secondary : .primary, font: page.format == .log ? .codeSmall : .body)
                }
            }
        }
    }
}
