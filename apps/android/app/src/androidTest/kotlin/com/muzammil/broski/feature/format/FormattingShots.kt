package com.muzammil.broski.feature.format

import android.app.UiAutomation
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.activity.ComponentActivity
import android.content.res.Configuration
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.muzammil.broski.Shots
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.format.FormattedText
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.broski_core.FormatSample
import uniffi.broski_core.formatSamples

/**
 * Every sample of the core's corpus drawn by the app's own formatter views, photographed page by page
 * into /sdcard/broski-shots/formatting: light and dark, font scale 1 and 2, upright and sideways, and a
 * table opened in the viewer. The proof of how agent text reads on Android, beside the iOS gallery run.
 */
@RunWith(AndroidJUnit4::class)
class FormattingShots {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val automation: UiAutomation get() = InstrumentationRegistry.getInstrumentation().uiAutomation
    private var look by mutableStateOf(Look(Appearance.Light, 1f, sample = formatSamples().first()))
    private val scroll = ScrollState(0)

    private data class Look(val appearance: Appearance, val fontScale: Float, val sample: FormatSample)

    @Before
    fun folder() {
        Shots.shell("mkdir -p /sdcard/broski-shots/formatting")
    }

    @After
    fun upright() {
        automation.setRotation(UiAutomation.ROTATION_FREEZE_0)
        automation.setRotation(UiAutomation.ROTATION_UNFREEZE)
    }

    @Test
    fun everySampleInBothAppearancesAtBothScalesUpright() {
        shootAll(UiAutomation.ROTATION_FREEZE_0, "portrait")
    }

    /**
     * Turned before anything is drawn, and drawn only once the activity turning recreates is the
     * one in front: turning drops whatever the old activity showed.
     */
    @Test
    fun everySampleInBothAppearancesAtBothScalesSideways() {
        shootAll(UiAutomation.ROTATION_FREEZE_90, "landscape")
    }

    private fun shootAll(rotation: Int, orientation: String) {
        automation.setRotation(rotation)
        val wanted = if (rotation == UiAutomation.ROTATION_FREEZE_0) Configuration.ORIENTATION_PORTRAIT else Configuration.ORIENTATION_LANDSCAPE
        compose.waitUntil(ROTATION_MS) {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync()
            compose.activity.resources.configuration.orientation == wanted
        }
        compose.setContent { Gallery() }
        for (appearance in listOf(Appearance.Light, Appearance.Dark)) {
            for (scale in listOf(1f, 2f)) {
                formatSamples().forEachIndexed { index, sample ->
                    look = Look(appearance, scale, sample)
                    pages("$orientation-${appearance.name.lowercase()}-x${scale.toInt()}-%02d-${slug(sample.title)}".format(index + 1))
                }
            }
        }
    }

    @Test
    fun aTableOpensWholeInTheViewer() {
        compose.setContent { Gallery() }
        look = Look(Appearance.Light, 1f, formatSamples().first { it.title == "Big tables" })
        compose.waitForIdle()
        compose.onAllNodesWithContentDescription("Expand").onFirst().performScrollTo().performClick()
        compose.waitForIdle()
        Thread.sleep(SETTLE_MS)
        Shots.save("formatting/portrait-light-x1-table-viewer")
    }

    @Composable
    private fun Gallery() {
        val density = LocalDensity.current
        BroskiTheme(look.appearance) {
            CompositionLocalProvider(LocalDensity provides Density(density.density, look.fontScale)) {
                Column(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).safeDrawingPadding()
                        .verticalScroll(scroll).padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Text(look.sample.title, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(bottom = 12.dp))
                    FormattedText(look.sample.text, streaming = look.sample.arriving)
                }
            }
        }
    }

    /** The sample from the top, a screen at a time, at most [MAX_PAGES]. */
    private fun pages(name: String) {
        compose.runOnIdle { scroll.dispatchRawDelta(-scroll.value.toFloat()) }
        for (page in 1..MAX_PAGES) {
            compose.waitForIdle()
            Thread.sleep(SETTLE_MS)
            Shots.save("formatting/$name-p$page")
            val before = scroll.value
            compose.runOnIdle { scroll.dispatchRawDelta(scroll.viewportSize * 0.9f) }
            compose.waitForIdle()
            if (scroll.value == before) return
        }
    }

    private fun slug(title: String) = title.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')

    private companion object {
        const val MAX_PAGES = 8

        /** The longest the emulator takes to turn and recreate the activity. */
        const val ROTATION_MS = 10_000L

        /** Code is coloured off the main thread; a language's first use compiles its grammar. */
        const val SETTLE_MS = 300L
    }
}
