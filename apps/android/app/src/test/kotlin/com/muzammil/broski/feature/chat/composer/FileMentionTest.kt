package com.muzammil.broski.feature.chat.composer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileMentionTest {
    @Test
    fun detectsAtMentionAtStartAfterWhitespaceAndAfterDelimiters() {
        assertEquals(FileMention(0, 1, ""), activeFileMention("@", commandActive = false))
        assertEquals(FileMention(8, 17, "src/auth"), activeFileMention("look at @src/auth", commandActive = false))
        assertEquals(FileMention(7, 14, "foo.ts"), activeFileMention("check (@foo.ts", commandActive = false))
        assertEquals(FileMention(6, 13, "README"), activeFileMention("line1\n@README", commandActive = false))
    }

    @Test
    fun detectsAndReplacesMentionInMiddleOfDraftAtCursor() {
        val text = "fix @src/au and run tests"
        val mention = requireNotNull(activeFileMention(text, commandActive = false, cursor = 11))
        assertEquals(FileMention(4, 11, "src/au"), mention)
        val replaced = replaceFileMention(text, mention, "src/auth/login.ts")
        assertEquals("fix @src/auth/login.ts and run tests", replaced.text)
        assertEquals(22, replaced.cursor)
    }

    @Test
    fun ignoresEmailsCompletedTokensAndActiveCommands() {
        assertNull(activeFileMention("email user@example.com", commandActive = false))
        assertNull(activeFileMention("look at @src/auth.ts and fix", commandActive = false))
        assertNull(activeFileMention("@foo", commandActive = true))
        assertNull(activeFileMention("", commandActive = false))
    }

    @Test
    fun replacesOnlyActiveMentionAndQuotesPathsWithSpaces() {
        val first = requireNotNull(activeFileMention("fix @src/au", commandActive = false))
        assertEquals(
            MentionReplacement("fix @src/auth/login.ts ", 23),
            replaceFileMention("fix @src/au", first, "src/auth/login.ts"),
        )

        val second = requireNotNull(activeFileMention("read @my", commandActive = false))
        assertEquals(
            MentionReplacement("read @\"docs/my notes.md\" ", 25),
            replaceFileMention("read @my", second, "docs/my notes.md"),
        )
    }

    @Test
    fun mentionCacheExpiresEntriesAfterTtl() {
        var now = 1_000L
        val cache = MentionCache(ttlMs = 30_000L, nowMs = { now })
        cache.put("src", listOf("src/a.ts"))
        now = 29_000L
        assertEquals(listOf("src/a.ts"), cache.get("src"))
        now = 32_000L
        assertNull(cache.get("src"))
    }
}
