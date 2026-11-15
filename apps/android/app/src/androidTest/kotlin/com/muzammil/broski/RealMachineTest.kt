package com.muzammil.broski

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.platform.app.InstrumentationRegistry
import com.muzammil.broski.app.BroskiApplication
import com.muzammil.broski.app.MainActivity
import com.muzammil.broski.core.CoreState
import com.muzammil.broski.core.PhoneSession
import java.io.File
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.NewSessionOptions
import uniffi.broski_contract.NewSessionResult
import uniffi.broski_contract.PromptInput
import uniffi.broski_contract.PromptMode
import uniffi.broski_contract.PromptRequest
import uniffi.broski_contract.ServerMessage
import uniffi.broski_contract.SessionCreateRequest
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.SessionUpdate
import uniffi.broski_core.SessionView
import uniffi.broski_core.parsePairingOffer

/**
 * The app against a real machine: `packages/link/testkit`'s `test-machine` (the real daemon and the
 * real bridge on its fake backend) on the host, its LAN port reversed into the emulator with
 * `adb reverse`, and its offer and served directory passed as the `offer` and `root` arguments
 * (apps/android/README.md). On a phone with nothing paired, it pastes the link, pairs through the
 * UI, starts a session on the bridge, and finds it in the inbox. The script has the machine run
 * its session "Clean the build folder" as a terminal would, waiting on a permission before it runs
 * a command: no phone prompted it, so the row learns the ask by itself, and the test approves it
 * from the row's long-press menu.
 */
@OptIn(ExperimentalTestApi::class)
class RealMachineTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val arguments = InstrumentationRegistry.getArguments()

    @Test
    fun aPastedLinkPairsAndTheMachinesSessionsReachTheInbox() {
        val offer = arguments.getString("offer")
        val root = arguments.getString("root")
        assumeTrue("needs -e offer and -e root from a running test-machine", offer != null && root != null)
        val name = parsePairingOffer(offer!!).name
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        compose.runOnUiThread {
            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("pairing link", offer))
        }

        compose.waitUntilExactlyOneExists(hasText(context.getString(R.string.pairing_paste)), TIMEOUT)
        compose.onNodeWithText(context.getString(R.string.pairing_paste)).performClick()
        val pairWith = context.getString(R.string.pairing_pair_with, name)
        compose.waitUntilExactlyOneExists(hasText(pairWith), TIMEOUT)
        compose.onNodeWithText(pairWith).performClick()
        compose.waitUntilAtLeastOneExists(hasText(context.getString(R.string.nav_inbox)), PAIRING_TIMEOUT)

        val phone = phone(context)
        val machine = requireNotNull(phone.machines.value.singleOrNull()) { "one machine after pairing" }
        val title = "Hello from Android ${UUID.randomUUID().toString().take(8)}"
        val view = runBlocking { startSession(phone, machine.id, root!!, title) }
        try {
            compose.waitUntilExactlyOneExists(hasContentDescription(title, substring = true), PAIRING_TIMEOUT)
            assertTrue(phone.inboxRows.value.any { it.title == title && it.machineId == machine.id })
        } finally {
            view.detach()
            view.close()
        }
        approveFromTheRow(context)
    }

    private fun approveFromTheRow(context: Context) {
        val ask = hasContentDescription(context.getString(R.string.inbox_wants_to_run, context.getString(R.string.agent_pi), "bash"), substring = true)
        compose.waitUntilExactlyOneExists(ask, PAIRING_TIMEOUT)
        screenshot(context, "inbox-needs-you")
        compose.onNode(ask).performTouchInput { longClick() }
        val approve = context.getString(R.string.inbox_approve)
        compose.waitUntilExactlyOneExists(hasText(approve), TIMEOUT)
        compose.onNodeWithText(context.getString(R.string.inbox_deny)).assertExists()
        screenshot(context, "inbox-row-actions")
        compose.onNodeWithText(approve).performClick()
        compose.waitUntilDoesNotExist(ask, PAIRING_TIMEOUT)
        compose.onNodeWithText(context.getString(R.string.inbox_answered_elsewhere)).assertDoesNotExist()
        screenshot(context, "inbox-approved")
    }

    /** The screen as a PNG in the app's external files, which the script pulls. */
    private fun screenshot(context: Context, name: String) {
        compose.waitForIdle()
        val directory = File(requireNotNull(context.getExternalFilesDir(null)), "screenshots").apply { mkdirs() }
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun phone(context: Context): PhoneSession {
        val state = (context.applicationContext as BroskiApplication).core.state.value
        return (state as CoreState.Ready).session
    }

    /** A Pi session on the bridge with one prompt, which becomes its title; the bridge takes a prompt only for a viewed session. */
    private suspend fun startSession(phone: PhoneSession, machineId: String, cwd: String, text: String): SessionView {
        val machine = requireNotNull(phone.machine(machineId))
        val create = ClientMessage.SessionCreate(
            SessionCreateRequest("", BackendId.PI, NewSessionOptions(cwd = cwd, modelId = null, thinking = null, modes = null)),
        )
        val created = machine.request(create) as ServerMessage.SessionCreateResult
        val session: SessionRef = (created.v1.result as NewSessionResult.Accepted).v1.session
        val view = machine.attach(session)
        check(view.nextUpdate() is SessionUpdate.Reset) { "the view starts from a snapshot" }
        val input = PromptInput(UUID.randomUUID().toString(), PromptMode.START, text, emptyList(), null)
        machine.request(ClientMessage.Prompt(PromptRequest("", session, input)))
        return view
    }

    private companion object {
        const val TIMEOUT = 10_000L
        const val PAIRING_TIMEOUT = 30_000L
    }
}
