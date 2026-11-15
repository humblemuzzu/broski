package com.muzammil.broski.app

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.muzammil.broski.R
import com.muzammil.broski.core.StartupFailure
import com.muzammil.broski.core.settings.Appearance
import com.muzammil.broski.design.BroskiTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class StartupFailedTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private var startedOver = 0

    private fun show(failure: StartupFailure) = compose.setContent {
        BroskiTheme(Appearance.System) { StartupFailed(failure) { startedOver++ } }
    }

    @Test
    fun aMissingIdentityStartsOverOnlyAfterTheConfirmation() {
        show(StartupFailure.IdentityMissing)
        compose.onNodeWithText(context.getString(R.string.startup_missing_title)).assertExists()

        compose.onNodeWithText(context.getString(R.string.startup_start_over)).performClick()
        compose.onNodeWithText(context.getString(R.string.startup_start_over_body)).assertExists()
        assertEquals(0, startedOver)

        compose.onNodeWithText(context.getString(R.string.action_cancel)).performClick()
        compose.onNodeWithText(context.getString(R.string.startup_start_over_body)).assertDoesNotExist()
        assertEquals(0, startedOver)

        compose.onNodeWithText(context.getString(R.string.startup_start_over)).performClick()
        compose.onNodeWithText(context.getString(R.string.startup_start_over_confirm)).performClick()
        assertEquals(1, startedOver)
    }

    @Test
    fun storageThatCannotBeReadOffersNoWayToStartOver() {
        show(StartupFailure.StorageUnreadable)
        compose.onNodeWithText(context.getString(R.string.startup_storage_title)).assertExists()
        compose.onNodeWithText(context.getString(R.string.startup_start_over)).assertDoesNotExist()
    }
}
