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
    /// The longest line's width at one point of text size, so a sideways-scrolling viewer is as wide
    /// as that line at any size: lines that do not wrap are then never cut or centred.
    @State private var widestPerPoint: CGFloat = 0
    @State private var zoom: CGFloat = 1
    @State private var copies = 0
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
                .frame(width: wraps ? nil : contentWidth, alignment: .leading)
                .padding(.vertical, Spacing.m)
            }
            .gesture(MagnifyGesture().updating($pinch) { value, state, _ in state = value.magnification }.onEnded { zoom *= $0.magnification })
            .background(Color(uiColor: .systemBackground))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
        }
        .haptic(.confirmed, trigger: copies)
        .task {
            lines = Highlighter.plainLines(code)
            widestPerPoint = Self.widestLine(code)
            if language != nil { lines = await Highlighter.shared.highlight(code, language: language) }
        }
    }

    private var contentWidth: CGFloat {
        let gutter = CGFloat(String(lines.count).count + 1) * size * 0.62
        return (widestPerPoint + 1) * size + gutter + Spacing.m + Spacing.l * 2
    }

    private static func widestLine(_ code: String) -> CGFloat {
        let font = UIFont.monospacedSystemFont(ofSize: 1, weight: .regular)
        return code.split(separator: "\n", omittingEmptySubsequences: false)
            .map { (String($0) as NSString).size(withAttributes: [.font: font]).width }
            .max() ?? 0
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
        .frame(maxWidth: .infinity, alignment: .leading)
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
            Button("Copy", systemImage: "doc.on.doc") {
                UIPasteboard.general.string = code
                copies += 1
            }
        }
    }
}
