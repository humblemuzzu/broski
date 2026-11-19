@testable import Broski
import Foundation
import Testing

struct FileMentionTests {
    @Test func detectsAtMentionAtStartAfterWhitespaceAndAfterDelimiters() {
        var draft = ComposerDraft(text: "@")
        #expect(draft.fileMention()?.query == "")

        draft.text = "look at @src/auth"
        #expect(draft.fileMention()?.query == "src/auth")

        draft.text = "check (@foo.ts"
        #expect(draft.fileMention()?.query == "foo.ts")

        draft.text = "line1\n@README"
        #expect(draft.fileMention()?.query == "README")
    }

    @Test func detectsAndReplacesMentionInMiddleOfDraftAtCursor() {
        var draft = ComposerDraft(text: "fix @src/au and run tests")
        // Cursor right after `@src/au` (UTF-16 offset 11).
        #expect(draft.fileMention(at: 11)?.query == "src/au")
        let nextCursor = draft.pickFile("src/auth/login.ts", at: 11)
        // Existing space before "and" is preserved without double-spacing.
        #expect(draft.text == "fix @src/auth/login.ts and run tests")
        #expect(nextCursor == 22)
    }

    @Test func ignoresEmailsCompletedTokensAndSlashCommands() {
        #expect(ComposerDraft(text: "email me at user@example.com").fileMention() == nil)
        #expect(ComposerDraft(text: "look at @src/auth.ts and fix").fileMention() == nil)
        #expect(ComposerDraft(text: "/compact@foo").fileMention() == nil)
        #expect(ComposerDraft(text: "").fileMention() == nil)
    }

    @Test func pickFileReplacesOnlyTheActiveMentionAndQuotesSpaces() {
        var draft = ComposerDraft(text: "fix @src/au")
        draft.pickFile("src/auth/login.ts")
        #expect(draft.text == "fix @src/auth/login.ts ")
        #expect(draft.fileMention() == nil)

        var spaced = ComposerDraft(text: "read @my")
        spaced.pickFile("docs/my notes.md")
        #expect(spaced.text == "read @\"docs/my notes.md\" ")
    }

    @Test func cacheExpiresAfterTtl() {
        let cache = FileMentionCache(ttl: 30)
        let t0 = Date(timeIntervalSince1970: 1_000)
        cache.put(root: "/repo", query: "src", paths: ["src/a.ts"], now: t0)
        #expect(cache.get(root: "/repo", query: "src", now: t0.addingTimeInterval(29)) == ["src/a.ts"])
        #expect(cache.get(root: "/repo", query: "src", now: t0.addingTimeInterval(31)) == nil)
    }
}
