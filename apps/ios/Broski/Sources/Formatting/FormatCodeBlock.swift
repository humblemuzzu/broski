import BroskiCore
import SwiftUI
import UIKit

/// A fenced block: a header with the language's name, the fence's file name and the line count,
/// Wrap, Copy and Expand; the code scrolls sideways (text-like fences wrap), folds past 30 lines,
/// is coloured line by line as it arrives, a `diff` fence draws as a diff, and a shell fence dims
/// the `$` prompt that copying leaves out.
struct FormatCodeBlock: View {
    let code: FormatCode
    let streaming: Bool
    @Environment(\.reading) private var reading
    @Environment(\.dynamicTypeSize) private var typeSize
    @AppStorage(Preference.readingWrapsCode) private var wrapsByDefault = false
    @ScaledMetric(relativeTo: .body) private var codeSize = FormatTokens.codeSize
    @State private var coloured: [CodeLine]?
    @State private var unfolded = false
    @State private var copied = 0

    private var kind: CodeKind { CodeKind(language: code.language) }
    private var plainLines: [Substring] { code.text.split(separator: "\n", omittingEmptySubsequences: false) }
    private var wraps: Bool { code.prose || reading.wrapsCode || typeSize.isAccessibilitySize }

    var body: some View {
        if kind == .diff, code.closed, let file = parseUnifiedDiff(text: code.text).files.first {
            card { DiffBody(file: file, showsHeader: false).padding(.bottom, Spacing.xs) }
        } else {
            card { lines }
                .task(id: completedText) { await colour() }
        }
    }

    private func card<Body: View>(@ViewBuilder _ content: () -> Body) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.codeBackground, in: .rect(cornerRadius: FormatTokens.codeRadius, style: .continuous))
        .contextMenu { menu }
        .haptic(.confirmed, trigger: copied)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: Spacing.s) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let file = code.file {
                Text(file)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            if plainLines.count > FormatTokens.codeCountLines {
                Text("^[\(plainLines.count) line](inflect: true)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .fixedSize()
            }
            Spacer(minLength: Spacing.xs)
            if !code.prose && kind != .diff {
                headerButton(wraps ? "arrow.left.and.right.text.vertical" : "text.word.spacing", label: wraps ? "Scroll sideways" : "Wrap lines") {
                    wrapsByDefault.toggle()
                }
            }
            headerButton(copied > 0 ? "checkmark" : "doc.on.doc", label: "Copy code") { copy() }
            headerButton("arrow.up.left.and.arrow.down.right", label: "Expand") { expand() }
        }
        .padding(.leading, Spacing.m)
        .padding(.trailing, Spacing.xxs)
        .padding(.vertical, Spacing.xxs)
    }

    private func headerButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .contentTransition(.symbolEffect(.replace))
                .font(.caption.weight(.medium))
                .frame(minWidth: 36, minHeight: 32)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityLabel(label)
    }

    private var title: String {
        if kind == .mermaid { return "Mermaid diagram" }
        return code.language.map { languageLabel(label: $0) } ?? "Text"
    }

    @ViewBuilder
    private var lines: some View {
        let folds = plainLines.count > FormatTokens.codeFoldLines && !unfolded
        let text = Text(attributed(limit: folds ? FormatTokens.codeFoldLines : nil))
            .font(.system(size: codeSize, design: .monospaced))
            .lineSpacing(2)
            .padding(.horizontal, Spacing.m)
            .padding(.top, Spacing.xxs)
            .padding(.bottom, folds ? Spacing.xs : Spacing.m)
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if wraps {
                    text.frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ScrollView(.horizontal) { text.fixedSize(horizontal: true, vertical: false) }
                        .scrollIndicators(.hidden)
                        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                }
            }
            .mask(alignment: .top) {
                if folds {
                    LinearGradient(stops: [.init(color: .black, location: 0.8), .init(color: .black.opacity(0.35), location: 1)], startPoint: .top, endPoint: .bottom)
                } else {
                    Rectangle()
                }
            }
            if folds { foldButton }
        }
    }

    private var foldButton: some View {
        Button {
            withAnimation(.easeOut(duration: 0.2)) { unfolded = true }
        } label: {
            Text("Show ^[\(plainLines.count - FormatTokens.codeFoldLines) more line](inflect: true)")
                .font(.footnote.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 36)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(FormatTokens.link)
    }

    /// The lines to draw, coloured as far as the highlighter has got, the rest plain.
    private func attributed(limit: Int?) -> AttributedString {
        let plain = plainLines
        let count = limit.map { min($0, plain.count) } ?? plain.count
        var text = AttributedString()
        for index in 0..<count {
            if index > 0 { text += AttributedString("\n") }
            let line = coloured.flatMap { index < $0.count ? $0[index] : nil } ?? CodeLine.plain(plain[index])
            text += kind == .shell ? Self.dimmingPrompt(line) : line.attributed
        }
        return text
    }

    private static func dimmingPrompt(_ line: CodeLine) -> AttributedString {
        var text = line.attributed
        let characters = text.characters
        if characters.starts(with: "$ ") {
            let end = text.index(text.startIndex, offsetByCharacters: 2)
            text[text.startIndex..<end].foregroundColor = Color(uiColor: .tertiaryLabel)
        }
        return text
    }

    /// The text up to its last complete line while it streams: colour a line once it has ended.
    private var completedText: String {
        if code.closed || !streaming { return code.text }
        guard let end = code.text.lastIndex(of: "\n") else { return "" }
        return String(code.text[..<end])
    }

    private func colour() async {
        let text = completedText
        guard !text.isEmpty, code.language != nil else { return }
        coloured = await Highlighter.shared.highlight(text, language: code.language)
    }

    /// What Copy puts on the pasteboard: a shell block without its prompts.
    private var copyText: String {
        guard kind == .shell else { return code.text }
        return plainLines.map { $0.hasPrefix("$ ") ? String($0.dropFirst(2)) : String($0) }.joined(separator: "\n")
    }

    private func copy() {
        UIPasteboard.general.string = copyText
        copied += 1
    }

    private func expand() {
        let viewer = CodeViewer(code: code.text, language: code.language, title: code.file ?? title, wraps: wraps)
        FormatPresenter.present(UIHostingController(rootView: viewer))
    }

    @ViewBuilder
    private var menu: some View {
        Button("Copy Code", systemImage: "doc.on.doc") { copy() }
        Button("Copy as Markdown", systemImage: "number") {
            UIPasteboard.general.string = "```\(code.language ?? "")\n\(code.text)\n```"
        }
        Button("Expand", systemImage: "arrow.up.left.and.arrow.down.right") { expand() }
        ShareLink(item: copyText)
    }
}

/// What a fence's language makes of the block beyond its colours.
nonisolated enum CodeKind: Equatable {
    case code
    case diff
    case shell
    case mermaid

    init(language: String?) {
        switch language?.lowercased() {
        case "diff", "patch": self = .diff
        case "sh", "bash", "zsh", "shell", "console", "shellsession", "terminal": self = .shell
        case "mermaid": self = .mermaid
        default: self = .code
        }
    }
}
