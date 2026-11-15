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

/// Links the model's text raises open only the web and mail; any other scheme is plain text.
@Test func onlyWebAndMailLinksComeBackAsLinks() {
    let blocks = markdownBlocks(text: "[web](https://x.dev) [call](tel:+1555) [app](intent://x)")
    guard case .paragraph(let runs) = blocks[0].content else {
        Issue.record("not a paragraph: \(blocks[0])")
        return
    }
    #expect(runs.filter { $0.link != nil }.map(\.text) == ["web"])
}

/// What the work fold shows of a tool call, and what a form field shows, decided by the core.
@Test func aToolCallAndAFormFieldAreReadByTheCore() {
    let input = JsonValue.object([JsonMember(key: "command", value: .string("npm test"))])
    let look = toolLook(facts: ToolFacts(name: "Bash", title: nil, input: input, hasChildSession: false, changedPaths: []))
    #expect(look.kind == .command)
    #expect(look.label == "npm test" && look.verb == "Ran command" && look.command == "npm test")
    #expect(foldCounts(tools: [FoldTool(id: "1", kind: look.kind, paths: look.paths)]).map(\.phrase) == ["Ran 1 command"])

    let field = FormFieldSpec.boolean(BooleanField(
        key: "deploy", title: nil, description: nil, required: false, hidden: false,
        when: [FieldCondition(key: "env", op: .eq, value: .text(TextValue(value: "prod")))], defaultValue: true))
    #expect(formFieldShown(field: field, values: ["env": .text(TextValue(value: "prod"))]))
    #expect(!formFieldShown(field: field, values: ["env": .text(TextValue(value: "dev"))]))
    #expect(formFieldDefault(field: field) == .boolean(BooleanValue(value: true)))
}
