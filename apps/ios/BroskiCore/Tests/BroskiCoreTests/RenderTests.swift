import BroskiCore
import Testing

/// The rendering exports from Swift: what a code view and a diff view draw.
@Test func codeAndDiffsComeBackReadyToDraw() throws {
    let lines = highlight(code: "let x = 1", language: "swift")
    #expect(lines.first?.spans.first == CodeSpan(text: "let", kind: .keyword))
    #expect(languageForPath(path: "App.kt") == "Kotlin")

    let diff = parseUnifiedDiff(text: "@@ -1 +1 @@\n-let a = 1\n+let a = 2\n")
    let hunk = try #require(diff.files.first?.hunks.first)
    #expect(hunk.lines.map(\.kind) == [.removed, .added])
    #expect(hunk.lines[1].segments.contains(DiffSegment(text: "2", emphasized: true)))
    #expect(sideBySide(hunk: hunk).count == 1)
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
