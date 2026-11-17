import BroskiCore
import SwiftUI
import UIKit

/// A code block opened whole: numbered lines, coloured, drawn as they scroll into view; Wrap,
/// Copy, and a pinch to change the text size.
struct CodeViewer: View {
    let code: String
    let language: String?
    let title: String
    @State var wraps: Bool
    @State private var lines: [CodeLine] = []
    @State private var zoom: CGFloat = 1
    @GestureState private var pinch: CGFloat = 1
    @ScaledMetric(relativeTo: .body) private var codeSize = FormatTokens.codeSize
    @Environment(\.dismiss) private var dismiss

    private var size: CGFloat { min(max(codeSize * zoom * pinch, 9), 34) }

    var body: some View {
        NavigationStack {
            ScrollView(wraps ? .vertical : [.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(lines.indices, id: \.self) { index in
                        row(index)
                    }
                }
                .padding(.vertical, Spacing.m)
            }
            .gesture(MagnifyGesture().updating($pinch) { value, state, _ in state = value.magnification }.onEnded { zoom *= $0.magnification })
            .background(Color(uiColor: .systemBackground))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
        }
        .task {
            lines = Highlighter.plainLines(code)
            if language != nil { lines = await Highlighter.shared.highlight(code, language: language) }
        }
    }

    private func row(_ index: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
            ZStack(alignment: .trailing) {
                Text(String(lines.count)).hidden()
                Text(index + 1, format: .number.grouping(.never))
            }
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
            Text(lines[index].attributed)
                .fixedSize(horizontal: !wraps, vertical: true)
                .frame(maxWidth: wraps ? .infinity : nil, alignment: .leading)
                .textSelection(.enabled)
        }
        .font(.system(size: size, design: .monospaced))
        .padding(.horizontal, Spacing.l)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Done") { dismiss() }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            Button(wraps ? "Scroll Sideways" : "Wrap Lines", systemImage: wraps ? "arrow.left.and.right.text.vertical" : "text.word.spacing") {
                wraps.toggle()
            }
            Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = code }
        }
    }
}
