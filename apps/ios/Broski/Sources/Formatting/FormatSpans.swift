import BroskiCore
import SwiftUI

/// How spans are styled in one text: its font, the inline code font (about 0.9 of it), and the
/// reader's choice of underlined links.
struct SpanStyle: Equatable {
    var font: Font
    var codeFont: Font
    var underlinesLinks = false
    /// A fixed size in points, where the text is zoomed rather than sized by Dynamic Type.
    var size: CGFloat?
}

enum FormatSpans {
    /// Spans as styled text. Links carry their target as a URL the formatter's own open action
    /// reads (`FormatLinkAction`); a link that may not open is drawn as plain text.
    static func attributed(_ spans: [FormatSpan], style: SpanStyle) -> AttributedString {
        var text = AttributedString()
        for span in spans {
            text += piece(span, style: style)
        }
        return text
    }

    private static func piece(_ span: FormatSpan, style: SpanStyle) -> AttributedString {
        if let link = span.link, link.image { return image(span, link: link, style: style) }
        if span.code || span.math { return chip(span, style: style) }
        var piece = AttributedString(span.text)
        piece.font = font(span, base: style.font)
        if span.strike {
            piece.strikethroughStyle = .single
            piece.foregroundColor = .secondary
        }
        if span.html {
            piece.font = style.codeFont
            piece.foregroundColor = .secondary
        }
        apply(span.link, to: &piece, style: style)
        return piece
    }

    private static func font(_ span: FormatSpan, base: Font) -> Font {
        switch (span.strong, span.emphasis) {
        case (true, true): base.weight(.semibold).italic()
        case (true, false): base.weight(.semibold)
        case (false, true): base.italic()
        case (false, false): base
        }
    }

    /// Inline code and math: a tinted chip, a thin space of air inside each end.
    private static func chip(_ span: FormatSpan, style: SpanStyle) -> AttributedString {
        var piece = AttributedString("\u{202F}\(span.text)\u{202F}")
        var font = style.codeFont
        if span.strong { font = font.weight(.semibold) }
        if span.math || span.emphasis { font = font.italic() }
        piece.font = font
        piece.backgroundColor = FormatTokens.inlineCodeFill
        if span.strike { piece.strikethroughStyle = .single }
        apply(span.link, to: &piece, style: style)
        return piece
    }

    /// An image is never loaded: a chip naming it and where it lives, opening in the browser.
    private static func image(_ span: FormatSpan, link: FormatLink, style: SpanStyle) -> AttributedString {
        let host = URL(string: link.target)?.host() ?? link.target
        let name = span.text.isEmpty ? "Image" : span.text
        var piece = AttributedString("\u{202F}\(name) · \(host)\u{202F}")
        piece.font = style.font.weight(.medium)
        piece.backgroundColor = FormatTokens.inlineCodeFill
        apply(link, to: &piece, style: style)
        return piece
    }

    private static func apply(_ link: FormatLink?, to piece: inout AttributedString, style: SpanStyle) {
        guard let link else { return }
        if link.kind == .footnote {
            piece.baselineOffset = 5
            piece.font = .caption2.weight(.semibold)
            piece.foregroundColor = FormatTokens.link
            return
        }
        guard let url = FormatLinkTarget(link)?.url else { return }
        piece.link = url
        piece.foregroundColor = FormatTokens.link
        if style.underlinesLinks { piece.underlineStyle = .single }
    }
}

/// What a link opens, carried in the drawn text as a URL: the page or address itself, or an
/// internal `broski-file:` URL naming a path and its line.
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
