import BroskiCore
import SwiftUI

struct SpanStyle: Equatable {
    var font: Font
    var codeFont: Font
    var underlinesLinks = false
    var size: CGFloat?
    var opensFiles = true
    var strongColor: Color?
    var inlineCodeColor: Color? = FormatTokens.inlineCodeText
    var inlineCodeStyle: InlineCodeStyle = .plain
}

enum FormatSpans {
    static func text(_ spans: [FormatSpan], style: SpanStyle) -> Text {
        var text = Text(verbatim: "")
        var run = AttributedString()
        for span in spans {
            if let link = span.link, link.image {
                let chip = image(span, link: link, style: style)
                text = Text("\(text)\(Text(run))\(Text(chip).customAttribute(ChipAttribute(kind: .image)))")
                run = AttributedString()
            } else if style.inlineCodeStyle == .tinted, span.code, !opensFile(span.link, style: style) {
                let codePiece = piece(span, style: style)
                text = Text("\(text)\(Text(run))\(Text(codePiece).customAttribute(ChipAttribute(kind: .codeTint)))")
                run = AttributedString()
            } else {
                run += piece(span, style: style)
            }
        }
        return Text("\(text)\(Text(run))")
    }

    static func attributed(_ spans: [FormatSpan], style: SpanStyle) -> AttributedString {
        spans.reduce(into: AttributedString()) { text, span in
            if let link = span.link, link.image {
                text += image(span, link: link, style: style)
            } else {
                text += piece(span, style: style)
            }
        }
    }

    private static func opensFile(_ link: FormatLink?, style: SpanStyle) -> Bool {
        guard let link, case .file = link.kind else { return false }
        return opens(link, style: style)
    }

    private static func piece(_ span: FormatSpan, style: SpanStyle) -> AttributedString {
        var piece = AttributedString(span.text)
        let isCodeLike = span.code || span.math || span.html
        let base = isCodeLike ? style.codeFont : style.font
        piece.font = font(span, base: base)
        if span.code || span.math, let codeColor = style.inlineCodeColor {
            piece.foregroundColor = codeColor
        }
        if span.strong, let strong = style.strongColor {
            piece.foregroundColor = strong
        }
        if span.strike {
            piece.strikethroughStyle = .single
            piece.foregroundColor = .secondary
        }
        if span.html {
            piece.foregroundColor = .secondary
        }
        apply(span.link, to: &piece, style: style)
        return piece
    }

    private static func font(_ span: FormatSpan, base: Font) -> Font {
        let italic = span.emphasis || span.math
        switch (span.strong, italic) {
        case (true, true): return base.weight(.semibold).italic()
        case (true, false): return base.weight(.semibold)
        case (false, true): return base.italic()
        case (false, false): return base
        }
    }

    private static func image(_ span: FormatSpan, link: FormatLink, style: SpanStyle) -> AttributedString {
        let detail = link.kind == .web ? (URL(string: link.target)?.host() ?? link.target) : (link.target as NSString).lastPathComponent
        let name = span.text.isEmpty ? detail : span.text
        let label = name == detail ? name : "\(name) · \(detail)"
        var piece = AttributedString("\u{202F}\(label)\u{202F}")
        piece.font = style.font.weight(.medium)
        apply(link, to: &piece, style: style)
        return piece
    }

    private static func opens(_ link: FormatLink?, style: SpanStyle) -> Bool {
        guard let link, FormatLinkTarget(link) != nil else { return false }
        if case .file = link.kind { return style.opensFiles }
        return true
    }

    private static func apply(_ link: FormatLink?, to piece: inout AttributedString, style: SpanStyle) {
        guard let link else { return }
        if link.kind == .footnote {
            piece.baselineOffset = 5
            piece.font = .caption2.weight(.semibold)
            piece.foregroundColor = FormatTokens.link
            return
        }
        guard opens(link, style: style), let url = FormatLinkTarget(link)?.url else { return }
        piece.link = url
        if case .file = link.kind {
            piece.foregroundColor = FormatTokens.path
            return
        }
        piece.foregroundColor = FormatTokens.link
        if style.underlinesLinks { piece.underlineStyle = .single }
    }
}

nonisolated enum ChipKind: Hashable {
    case image
    case codeTint
}

nonisolated struct ChipAttribute: TextAttribute {
    let kind: ChipKind
}

nonisolated struct ChipRenderer: TextRenderer {
    var displayPadding: EdgeInsets { EdgeInsets(top: 2, leading: 3, bottom: 2, trailing: 3) }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            for item in chipRects(line) {
                let path = Path(roundedRect: item.rect, cornerRadius: FormatTokens.inlineCodeRadius, style: .continuous)
                let fill = item.kind == .codeTint ? FormatTokens.inlineCodeTintFill : FormatTokens.imageChipFill
                context.fill(path, with: .color(fill))
            }
        }
        for line in layout {
            context.draw(line)
        }
    }

    private func chipRects(_ line: Text.Layout.Line) -> [(rect: CGRect, kind: ChipKind)] {
        var raw: [(rect: CGRect, kind: ChipKind)] = []
        for run in line {
            guard let attr = run[ChipAttribute.self] else { continue }
            let bounds = run.typographicBounds.rect
            if let last = raw.last, last.kind == attr.kind,
               abs(last.rect.maxX - bounds.minX) < 0.5 || abs(bounds.maxX - last.rect.minX) < 0.5
            {
                raw[raw.count - 1].rect = last.rect.union(bounds)
            } else {
                raw.append((bounds, attr.kind))
            }
        }
        return raw.map { item in
            let inset = item.kind == .codeTint ? item.rect.insetBy(dx: -2, dy: -0.5) : item.rect.insetBy(dx: -1, dy: -1)
            return (inset, item.kind)
        }
    }
}

nonisolated enum FormatLinkTarget: Equatable {
    case web(URL)
    case mail(URL)
    case file(path: String, line: Int?)

    static let fileScheme = "broski-file"

    init?(_ link: FormatLink) {
        switch link.kind {
        case .web:
            guard let url = URL(string: link.target) ?? URL(string: link.target.addingPercentEncoding(withAllowedCharacters: .urlFragmentAllowed) ?? "")
            else { return nil }
            self = .web(url)
        case .mail:
            guard let url = URL(string: link.target) else { return nil }
            self = .mail(url)
        case .file(let line, _):
            self = .file(path: link.target, line: line.map { Int($0) })
        case .footnote, .inert:
            return nil
        }
    }

    init?(url: URL) {
        switch url.scheme?.lowercased() {
        case "http", "https": self = .web(url)
        case "mailto": self = .mail(url)
        case Self.fileScheme:
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard let path = items.first(where: { $0.name == "path" })?.value else { return nil }
            self = .file(path: path, line: items.first { $0.name == "line" }?.value.flatMap { Int($0) })
        default: return nil
        }
    }

    var url: URL? {
        switch self {
        case .web(let url), .mail(let url): return url
        case .file(let path, let line):
            var components = URLComponents()
            components.scheme = Self.fileScheme
            components.queryItems = [URLQueryItem(name: "path", value: path)] + (line.map { [URLQueryItem(name: "line", value: String($0))] } ?? [])
            return components.url
        }
    }
}
