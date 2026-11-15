package com.muzammil.broski.feature.chat.composer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Fitting an image to the prompt's base64 bound, with an encoder whose output grows with the pixels
 * and the quality as a JPEG's does, recording what it was asked for.
 */
class ImageFitTest {
    private val asked = mutableListOf<Triple<Int, Int, Int>>()

    private fun encoder(bytesPerPixelAt85: Double): (Int, Int, Int) -> ByteArray = { width, height, quality ->
        asked += Triple(width, height, quality)
        ByteArray((width.toLong() * height * bytesPerPixelAt85 * quality / 85).toInt())
    }

    @Test
    fun aLargePhotoIsSentAtTheLongestSideAndBestQualityThatFit() {
        val bytes = fitImage(4_000, 3_000, MAX_IMAGE_CHARS, encoder(0.25))!!
        assertEquals(Triple(2_048, 1_536, 85), asked.first())
        assertTrue(base64Length(bytes.size) <= MAX_IMAGE_CHARS)
        assertEquals(Triple(2_048, 1_536, 85), asked.last())
    }

    @Test
    fun whatTheOtherImagesLeaveLowersTheQualityThenTheSize() {
        val budget = 1_000_000
        val bytes = fitImage(2_000, 2_000, budget, encoder(0.5))!!
        assertTrue(base64Length(bytes.size) <= budget)
        assertEquals(listOf(85, 70, 55), asked.take(3).map { it.third })
        val (width, height, _) = asked.last()
        assertTrue("smaller by quarters", width < 2_000 && width == height)
    }

    @Test
    fun anImageThatCannotFitAboveTheSmallestUsefulSizeIsRefused() {
        assertNull(fitImage(4_000, 4_000, budget = 100, encoder(1.0)))
        assertTrue(asked.all { maxOf(it.first, it.second) >= MIN_SIDE })
    }

    @Test
    fun aSmallImageKeepsItsSize() {
        fitImage(200, 100, MAX_IMAGE_CHARS, encoder(0.25))
        assertEquals(Triple(200, 100, 85), asked.single())
    }

    @Test
    fun base64TakesFourCharactersForEveryThreeBytesRoundedUp() {
        assertEquals(listOf(0, 4, 4, 4, 8), listOf(0, 1, 2, 3, 4).map(::base64Length))
    }
}
