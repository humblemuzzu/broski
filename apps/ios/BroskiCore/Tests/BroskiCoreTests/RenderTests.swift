import BroskiCore
import Testing

/// The rendering exports from Swift: what a chat bubble, a code block and a diff view draw.
@Test func markdownCodeAndDiffsComeBackReadyToDraw() throws {
    let blocks = markdownBlocks(text: "Run **this**:\n\n```swift\nlet x = 1\n```")
    #expect(blocks.map(\.key) == ["p-0", "code-15"])
    guard case .paragraph(let runs) = blocks[0].content else {
        Issue.record("not a paragraph: \(blocks[0])")
        return
    }
    #expect(runs.map(\.text) == ["Run ", "this", ":"])
    #expect(runs[1].strong)
    guard case .code(let language, let code) = blocks[1].content else {
        Issue.record("not code: \(blocks[1])")
        return
    }
    let lines = highlight(code: code, language: language)
    #expect(lines.first?.spans.first == CodeSpan(text: "let", kind: .keyword))
    #expect(languageForPath(path: "App.kt") == "Kotlin")

    let diff = parseUnifiedDiff(text: "@@ -1 +1 @@\n-let a = 1\n+let a = 2\n")
    let hunk = try #require(diff.files.first?.hunks.first)
    #expect(hunk.lines.map(\.kind) == [.removed, .added])
    #expect(hunk.lines[1].segments.contains(DiffSegment(text: "2", emphasized: true)))
    #expect(sideBySide(hunk: hunk).count == 1)
}
