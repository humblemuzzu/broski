package com.muzammil.broski.feature.chat.composer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileMentionTest {
    @Test
    fun detectsAtMentionAtStartAfterWhitespaceAndAfterDelimiters() {
        assertEquals(FileMention(0, ""), activeFileMention("@", commandActive = false))
        assertEquals(FileMention(8, "src/auth"), activeFileMention("look at @src/auth", commandActive = false))
        assertEquals(FileMention(7, "foo.ts"), activeFileMention("check (@foo.ts", commandActive = false))
        assertEquals(FileMention(6, "README"), activeFileMention("line1\n@README", commandActive = false))
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
        assertEquals("fix @src/auth/login.ts ", replaceFileMention("fix @src/au", first, "src/auth/login.ts"))

        val second = requireNotNull(activeFileMention("read @my", commandActive = false))
        assertEquals("read @\"docs/my notes.md\" ", replaceFileMention("read @my", second, "docs/my notes.md"))
    }
}
