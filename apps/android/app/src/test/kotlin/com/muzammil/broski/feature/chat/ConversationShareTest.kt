package com.muzammil.broski.feature.chat

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ConversationShareTest {
    @get:Rule
    val folder = TemporaryFolder()

    @Test
    fun aConversationGoesInlineUpToTheLimitAndAsAFileBeyondIt() {
        assertFalse(shouldShareAsFile(""))
        assertFalse(shouldShareAsFile("a".repeat(INLINE_SHARE_LIMIT)))
        assertTrue(shouldShareAsFile("a".repeat(INLINE_SHARE_LIMIT + 1)))
    }

    @Test
    fun theFileHoldsTheTextAsUtf8UnderASafeNameInTheSharedFolder() {
        val dir = File(folder.root, "shared")
        val text = "> fix the café test 🚀\n\nDone."
        val file = writeShareFile(dir, "../Fix: the café test!", text, nowMs = 42)
        assertEquals(dir, file.parentFile)
        assertEquals("42-Fix_the_caf_test.md", file.name)
        assertEquals(text, file.readBytes().toString(Charsets.UTF_8))
        assertEquals("42-conversation.md", writeShareFile(dir, "日本語", "x", nowMs = 42).name)
    }

    @Test
    fun onlyTheNewestFilesAreKept() {
        val dir = File(folder.root, "shared")
        repeat(15) { index -> writeShareFile(dir, "s", "x", nowMs = index.toLong()).setLastModified(index * 1_000L) }
        val names = dir.listFiles().orEmpty().map { it.name }.toSet()
        assertEquals(10, names.size)
        assertTrue("the newest is kept", "14-s.md" in names)
        assertFalse("the oldest is gone", "0-s.md" in names)
    }
}
