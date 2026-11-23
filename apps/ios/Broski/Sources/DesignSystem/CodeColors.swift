import BroskiCore
import SwiftUI

/// Colours for the core's token kinds (rendering.md, "Highlighting"): GitHub's light and dark
/// syntax palettes, each AA against the code background in its appearance.
extension TokenKind {
    var color: Color? {
        switch self {
        case .plain, .variable: nil
        case .comment: Color(light: 0x6E7781, dark: 0x8B949E)
        case .keyword, .operator: Color(light: 0xCF222E, dark: 0xFF7B72)
        case .string: Color(light: 0x0A3069, dark: 0xA5D6FF)
        case .number, .constant, .property, .attribute, .heading: Color(light: 0x0550AE, dark: 0x79C0FF)
        case .type: Color(light: 0x953800, dark: 0xFFA657)
        case .function: Color(light: 0x8250DF, dark: 0xD2A8FF)
        case .punctuation: Color(light: 0x57606A, dark: 0x9DA5AE)
        case .tag, .inserted: Color(light: 0x116329, dark: 0x7EE787)
        case .deleted: Color(light: 0x82071E, dark: 0xFFA198)
        }
    }
}

extension Palette {
    static let codeBackground = Color(light: 0xF6F6F8, dark: 0x1A1A1E)
}

extension CodeLine {
    /// The line as styled text; an empty line keeps its height.
    var attributed: AttributedString {
        guard !spans.isEmpty else { return AttributedString(" ") }
        var line = AttributedString()
        for span in spans {
            var piece = AttributedString(span.text)
            if let color = span.kind.color { piece.foregroundColor = color }
            line += piece
        }
        return line
    }

    /// A line no highlighter has coloured.
    static func plain(_ text: Substring) -> CodeLine {
        CodeLine(spans: text.isEmpty ? [] : [CodeSpan(text: String(text), kind: .plain)])
    }
}

/// Highlighted code, kept by text and language so a block is coloured once however often it is
/// drawn (rendering.md: "once per block key and text"). The core's highlighter runs off the main
/// actor; until it answers, the plain lines show in the same monospaced layout, so colouring never
/// moves anything.
@MainActor
final class Highlighter {
    static let shared = Highlighter()

    private struct Key: Hashable {
        let code: String
        let language: String?
    }

    private var lines: [Key: [CodeLine]] = [:]
    private var order: [Key] = []
    private let capacity = 256

    func cached(_ code: String, language: String?) -> [CodeLine]? {
        let key = Key(code: code, language: language)
        guard let found = lines[key] else { return nil }
        touch(key)
        return found
    }

    func highlight(_ code: String, language: String?) async -> [CodeLine] {
        let key = Key(code: code, language: language)
        if let known = lines[key] {
            touch(key)
            return known
        }
        let coloured = await Task.detached(priority: .userInitiated) {
            BroskiCore.highlight(code: code, language: language)
        }.value
        lines[key] = coloured
        touch(key)
        while order.count > capacity {
            let evicted = order.removeFirst()
            lines.removeValue(forKey: evicted)
        }
        return coloured
    }

    private func touch(_ key: Key) {
        if let existing = order.firstIndex(of: key) { order.remove(at: existing) }
        order.append(key)
    }

    static func plainLines(_ code: String) -> [CodeLine] {
        code.split(separator: "\n", omittingEmptySubsequences: false).map(CodeLine.plain)
    }
}
