import BroskiCore
import SwiftUI
import UIKit

struct FormatCodeBlock: View {
    let code: FormatCode
    let streaming: Bool
    @Environment(\.reading) private var reading
    @Environment(\.dynamicTypeSize) private var typeSize
    @AppStorage(Preference.readingWrapsCode) private var wrapsByDefault = false
    @ScaledMetric(relativeTo: .body) private var codeSize = FormatTokens.codeSize
    @Environment(Disclosure.self) private var disclosure: Disclosure?
    @Environment(\.disclosureKey) private var disclosureKey
    @State private var coloured: [CodeLine]?
    @State private var colourRevision = 0
    @State private var renderedKey: RenderedKey?
    @State private var renderedText = AttributedString()
    @State private var unfoldedHere = false
    @State private var copied = 0
    @State private var showCopied = false
    @State private var moreToTheRight = false

    private struct RenderedKey: Equatable {
        let text: String
        let language: String?
        let colourRevision: Int
        let limit: Int?
        let shell: Bool
    }

    private var unfolded: Bool {
        if let disclosure, let key = disclosureKey.map({ $0 + "/code" }) { disclosure.isOpen(key) } else { unfoldedHere }
    }

    private func unfold() {
        if let disclosure, let key = disclosureKey.map({ $0 + "/code" }) {
            if !disclosure.isOpen(key) { disclosure.toggle(key) }
        } else {
            unfoldedHere = true
        }
    }

    private var kind: CodeKind { CodeKind(language: code.language) }
    private var lineCount: Int {
        var count = 1
        for byte in code.text.utf8 where byte == 0x0A { count += 1 }
        return count
    }
    private var wraps: Bool { code.prose || reading.wrapsCode || typeSize.isAccessibilitySize }
    private let inset: CGFloat = Spacing.m + 2

    var body: some View {
        if kind == .diff, code.closed, let file = parseUnifiedDiff(text: code.text).files.first {
            card { DiffBody(file: file, showsHeader: false).padding(.vertical, Spacing.xs) }
        } else {
            card { lines }
                .task(id: completedText) { await colour() }
        }
    }

    private func card<Body: View>(@ViewBuilder _ content: () -> Body) -> some View {
        let shape = RoundedRectangle(cornerRadius: FormatTokens.codeRadius, style: .continuous)
        return VStack(alignment: .leading, spacing: 0) {
            header
            Rectangle()
                .fill(FormatTokens.cardBorder)
                .frame(height: 0.5)
                .accessibilityHidden(true)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.codeBackground, in: shape)
        .overlay { shape.strokeBorder(FormatTokens.cardBorder, lineWidth: 0.5) }
        .contextMenu { menu }
        .haptic(.confirmed, trigger: copied)
        .task(id: copied) {
            guard copied > 0 else { return }
            showCopied = true
            try? await Task.sleep(for: .milliseconds(1500))
            showCopied = false
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: Spacing.s) {
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            if let file = code.file {
                Text(file)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            let count = lineCount
            if count > FormatTokens.codeCountLines {
                Text("^[\(count) line](inflect: true)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .fixedSize()
            }
            Spacer(minLength: Spacing.xs)
            headerButton(showCopied ? "checkmark" : "doc.on.doc", label: "Copy code", accent: showCopied) { copy() }
            headerButton("arrow.up.left.and.arrow.down.right", label: "Expand") { expand() }
        }
        .padding(.leading, inset)
        .padding(.trailing, Spacing.xs)
        .frame(minHeight: 34)
    }

    private func headerButton(_ symbol: String, label: String, accent: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .contentTransition(.symbolEffect(.replace))
                .font(.caption.weight(.medium))
                .frame(minWidth: 34, minHeight: 30)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(accent ? Palette.done : Color(uiColor: .secondaryLabel))
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityLabel(label)
    }

    private var title: String {
        if kind == .mermaid { return "Mermaid diagram" }
        return code.language.map { languageLabel(label: $0) } ?? "Text"
    }

    @ViewBuilder
    private var lines: some View {
        let total = lineCount
        let folds = total > FormatTokens.codeFoldLines && !unfolded
        let limit = folds ? FormatTokens.codeFoldLines : nil
        let key = RenderedKey(
            text: code.text, language: code.language, colourRevision: colourRevision,
            limit: limit, shell: kind == .shell)
        let shown = renderedKey == key ? renderedText : attributed(limit: limit)
        let text = Text(shown)
            .font(.system(size: max(10, codeSize + reading.bodyPointOffset * 0.8), design: .monospaced))
            .lineSpacing(4)
            .padding(.horizontal, inset)
            .padding(.top, Spacing.m - 2)
            .padding(.bottom, folds ? Spacing.xs : Spacing.m)
            .onAppear {
                if renderedKey != key {
                    renderedText = shown
                    renderedKey = key
                }
            }
            .onChange(of: key) { _, next in
                renderedText = shown
                renderedKey = next
            }
        VStack(alignment: .leading, spacing: 0) {
            Group {
                if wraps {
                    text.frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ScrollView(.horizontal) { text.fixedSize(horizontal: true, vertical: false) }
                        .scrollIndicators(.hidden)
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
                                    .frame(width: moreToTheRight ? 22 : 0)
                            }
                        }
                }
            }
            .mask(alignment: .top) {
                if folds {
                    LinearGradient(stops: [.init(color: .black, location: 0.8), .init(color: .black.opacity(0.35), location: 1)], startPoint: .top, endPoint: .bottom)
                } else {
                    Rectangle()
                }
            }
            if folds { foldButton(hidden: total - FormatTokens.codeFoldLines) }
        }
    }

    private func foldButton(hidden: Int) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.2)) { unfold() }
        } label: {
            Text("Show ^[\(hidden) more line](inflect: true)")
                .font(.footnote.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 36)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(FormatTokens.link)
    }

    private func attributed(limit: Int?) -> AttributedString {
        let plain = code.text.split(separator: "\n", omittingEmptySubsequences: false)
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

    private var completedText: String {
        if code.closed || !streaming { return code.text }
        guard let end = code.text.lastIndex(of: "\n") else { return "" }
        return String(code.text[..<end])
    }

    private func colour() async {
        let text = completedText
        guard !text.isEmpty, code.language != nil else { return }
        coloured = await Highlighter.shared.highlight(text, language: code.language)
        colourRevision &+= 1
    }

    private var copyText: String {
        guard kind == .shell else { return code.text }
        return code.text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.hasPrefix("$ ") ? String($0.dropFirst(2)) : String($0) }
            .joined(separator: "\n")
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
        if !code.prose && kind != .diff && !typeSize.isAccessibilitySize {
            Button(wraps ? "Scroll Sideways" : "Wrap Lines", systemImage: wraps ? "arrow.left.and.right.text.vertical" : "text.word.spacing") {
                wrapsByDefault.toggle()
            }
        }
        Button("Copy as Markdown", systemImage: "number") {
            UIPasteboard.general.string = "```\(code.language ?? "")\n\(code.text)\n```"
        }
        Button("Expand", systemImage: "arrow.up.left.and.arrow.down.right") { expand() }
        ShareLink(item: copyText)
    }
}

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
