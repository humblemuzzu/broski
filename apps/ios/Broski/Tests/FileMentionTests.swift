@testable import Broski
import Testing

struct FileMentionTests {
    @Test func detectsAtMentionAtStartAfterWhitespaceAndAfterDelimiters() {
        var draft = ComposerDraft(text: "@")
        #expect(draft.fileMention?.query == "")

        draft.text = "look at @src/auth"
        #expect(draft.fileMention?.query == "src/auth")

        draft.text = "check (@foo.ts"
        #expect(draft.fileMention?.query == "foo.ts")

        draft.text = "line1\n@README"
        #expect(draft.fileMention?.query == "README")
    }

    @Test func ignoresEmailsCompletedTokensAndSlashCommands() {
        #expect(ComposerDraft(text: "email me at user@example.com").fileMention == nil)
        #expect(ComposerDraft(text: "look at @src/auth.ts and fix").fileMention == nil)
        #expect(ComposerDraft(text: "/compact@foo").fileMention == nil)
        #expect(ComposerDraft(text: "").fileMention == nil)
    }

    @Test func pickFileReplacesOnlyTheActiveMentionAndQuotesSpaces() {
        var draft = ComposerDraft(text: "fix @src/au")
        draft.pickFile("src/auth/login.ts")
        #expect(draft.text == "fix @src/auth/login.ts ")
        #expect(draft.fileMention == nil)

        var spaced = ComposerDraft(text: "read @my")
        spaced.pickFile("docs/my notes.md")
        #expect(spaced.text == "read @\"docs/my notes.md\" ")
    }
}
