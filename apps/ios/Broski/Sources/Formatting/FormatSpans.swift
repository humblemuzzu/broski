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
    /// A path can be opened: the text belongs to a machine (`FormatContext`). Where it does not, a
    /// path is drawn as the code it is.
    var opensFiles = true
    /// The colour of bold runs, where it differs from the text around them.
    var strongColor: Color?
}

enum FormatSpans {
    /// Spans as one text. Inline code, math and images are marked as chips, which `ChipRenderer`
    /// draws on a rounded fill; the text needs `.textRenderer(ChipRenderer())` to show them.
    static func text(_ spans: [FormatSpan], style: SpanStyle) -> Text {
        var text = Text(verbatim: "")
        var run = AttributedString()
        for span in spans {
            if let chip = chip(span, style: style) {
                text = Text("\(text)\(Text(run))\(Text(chip).customAttribute(ChipAttribute()))")
                run = AttributedString()
            } else {
                if let icon = linkIcon(span) { text = Text("\(text)\(Text(run))\(icon)"); run = AttributedString() }
                run += piece(span, style: style)
            }
        }
        return Text("\(text)\(Text(run))")
    }

    /// Spans as styled text for a log, which holds no inline code: its links, its paths and its plain
    /// words.
    static func attributed(_ spans: [FormatSpan], style: SpanStyle) -> AttributedString {
        spans.reduce(into: AttributedString()) { text, span in
            text += chip(span, style: style) ?? piece(span, style: style)
        }
    }

    private static func piece(_ span: FormatSpan, style: SpanStyle) -> AttributedString {
        var piece = AttributedString(span.text)
        piece.font = font(span, base: span.code ? style.codeFont : style.font)
        if span.strong, let strong = style.strongColor { piece.foregroundColor = strong }
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

    /// Inline code and math with nothing to open, and images: a thin space of air inside each end,
    /// for the fill to sit around. Code that opens something is drawn as what it opens.
    private static func chip(_ span: FormatSpan, style: SpanStyle) -> AttributedString? {
        if let link = span.link, link.image { return image(span, link: link, style: style) }
        guard span.code || span.math, !opens(span.link, style: style) else { return nil }
        var piece = AttributedString("\u{202F}\(span.text)\u{202F}")
        var font = style.codeFont
        if span.strong { font = font.weight(.semibold) }
        if span.math || span.emphasis { font = font.italic() }
        piece.font = font
        if span.strike { piece.strikethroughStyle = .single }
        return piece
    }

    /// An image is never loaded: a chip naming it and where it lives, opening in the browser.
    private static func image(_ span: FormatSpan, link: FormatLink, style: SpanStyle) -> AttributedString {
        let host = URL(string: link.target)?.host() ?? link.target
        let name = span.text.isEmpty ? "Image" : span.text
        var piece = AttributedString("\u{202F}\(name) · \(host)\u{202F}")
        piece.font = style.font.weight(.medium)
        apply(link, to: &piece, style: style)
        return piece
    }

    private static func opens(_ link: FormatLink?, style: SpanStyle) -> Bool {
        guard let link, FormatLinkTarget(link) != nil else { return false }
        if case .file = link.kind { return style.opensFiles }
        return true
    }

    /// A page the agent named by a title, not by its address, gets a globe so it reads as a link to
    /// leave by; a bare address already says where it goes.
    private static func linkIcon(_ span: FormatSpan) -> Text? {
        guard let link = span.link, link.kind == .web, !link.bare, !link.image, span.text != link.target else { return nil }
        return Text("\(Image(systemName: "globe"))\u{2009}").font(.footnote).foregroundStyle(FormatTokens.link)
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

/// Marks a run of text as a chip: inline code, math or an image's name.
nonisolated struct ChipAttribute: TextAttribute {}

/// Draws the text with a rounded fill behind each chip, under all the glyphs so a chip's fill never
/// covers a neighbouring letter. A chip's thin spaces come from a fallback font, which makes them
/// runs of their own: touching chip runs on a line are one fill.
nonisolated struct ChipRenderer: TextRenderer {
    var fill = FormatTokens.inlineCodeFill

    var displayPadding: EdgeInsets { EdgeInsets(top: 2, leading: 2, bottom: 2, trailing: 2) }

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout {
            for rect in chipRects(line) {
                context.fill(Path(roundedRect: rect, cornerRadius: FormatTokens.inlineCodeRadius, style: .continuous), with: .color(fill))
            }
        }
        for line in layout {
            context.draw(line)
        }
    }

    private func chipRects(_ line: Text.Layout.Line) -> [CGRect] {
        var rects: [CGRect] = []
        for run in line where run[ChipAttribute.self] != nil {
            let bounds = run.typographicBounds.rect.insetBy(dx: 0, dy: -1)
            if let last = rects.last, abs(last.maxX - bounds.minX) < 1 || abs(bounds.maxX - last.minX) < 1 {
                rects[rects.count - 1] = last.union(bounds)
            } else {
                rects.append(bounds)
            }
        }
        return rects
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
