package com.muzammil.broski

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.rule.GrantPermissionRule
import com.muzammil.broski.app.MainActivity
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runners.MethodSorters
import uniffi.broski_core.parsePairingOffer

/**
 * The app against a real machine: `packages/link/testkit`'s `test-machine` (the real daemon and the
 * real bridge on its fake backend) on the host, reached as scripts/test-android-real-machine.sh sets
 * it up. An offer pairs once, so the first test pairs through the UI and the others use that pairing,
 * in the order of their names. The second approves a terminal's permission ask from an inbox row;
 * the script then cold-starts the app with the machine stopped and expects that row in the cache.
 */
@OptIn(ExperimentalTestApi::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class RealMachineTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @get:Rule
    val notifications: GrantPermissionRule = GrantPermissionRule.grant(Manifest.permission.POST_NOTIFICATIONS)

    private val machine = RealMachine.fromArguments()
    private val ui = WorkspaceUiDriver(compose, machine)

    @Test
    fun a_aPastedLinkPairsAndTheMachinesSessionsReachTheInbox() {
        val context = machine.context
        val name = parsePairingOffer(machine.offer).name
        compose.runOnUiThread {
            context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("pairing link", machine.offer))
        }
        compose.waitUntilExactlyOneExists(hasText(context.getString(R.string.pairing_paste)), TIMEOUT)
        compose.onNodeWithText(context.getString(R.string.pairing_paste)).performClick()
        val pairWith = context.getString(R.string.pairing_pair_with, name)
        compose.waitUntilExactlyOneExists(hasText(pairWith), TIMEOUT)
        compose.onNodeWithText(pairWith).performClick()
        compose.waitUntilAtLeastOneExists(hasText(context.getString(R.string.nav_inbox)), PAIRING_TIMEOUT)
        // The system's clipboard preview stays over the next tests' screenshots until a real touch lands outside it.
        Shots.shell("input tap 1 1")

        val title = "Hello from Android ${UUID.randomUUID().toString().take(8)}"
        val view = runBlocking { machine.prompt(machine.newSession(), title) }
        try {
            compose.waitUntilExactlyOneExists(hasContentDescription(title, substring = true), PAIRING_TIMEOUT)
            assertTrue(machine.phone.inboxRows.value.any { it.title == title && it.machineId == machine.machineId })
        } finally {
            view.detach()
            view.close()
        }
    }

    @Test
    fun b_aTerminalsPermissionAskIsApprovedFromItsInboxRow() = InboxApproveFlow(ui, machine).run()

    @Test
    fun c_filesBrowseSearchAndRead() = WorkspaceFlows(ui, machine).files()

    @Test
    fun d_everyWorkspaceScreenInDarkAndAtTwiceTheFontSize() = WorkspaceFlows(ui, machine).appearances()

    @Test
    fun e_gitShowsADiffStagesBySwipeAndCommits() = WorkspaceFlows(ui, machine).git()

    @Test
    fun f_aTerminalRunsWhatIsTypedAndTheEngineShowsTheOutput() = WorkspaceFlows(ui, machine).terminal()

    @Test
    fun g_theLiveUpdateFollowsARunAndItsStopEndsIt() = LiveUpdateFlow(ui, machine).run()

    @Test
    fun h_theChatsCopyOfASessionEqualsTheCoresThroughEveryScenario() = ReplicaFlow(machine).run()

    private val chat = ChatFlows(ui, machine)

    @Test
    fun i_aSessionOpensFromTheInboxAndItsWorkStreamsIntoTheChat() = chat.openSendAndWatchWork()

    @Test
    fun j_aDenyTellsTheAgentWhatToDoInstead() = chat.denyWithInstructions()

    @Test
    fun k_anAllowedCommandRunsAndItsRowOpensToItsOutput() = chat.allowAndReadTheWork()

    @Test
    fun l_anAskIsAnsweredFromItsCard() = chat.answerAnAsk()

    @Test
    fun m_aMessageQueuesWhileTheRunHoldsAndStopEndsTheRun() = chat.queueWhileRunningThenStop()

    @Test
    fun n_theTitleIsRenamedFromTheHeader() = chat.renameFromTheHeader()

    @Test
    fun o_theNewSessionSheetStartsASessionAndOpensItsChat() = chat.newSessionFromTheSheet()

    @Test
    fun p_readingUpDetachesAndJumpToLatestComesBack() = chat.jumpToLatest()

    @Test
    fun q_theChatInDarkAndAtTwiceTheFontSize() = chat.appearances()

    @Test
    fun r_aThousandItemsScrollFromTheEndToTheFirstMessageAndBack() = ScrollFlow(ui, machine).run()

    private companion object {
        const val TIMEOUT = 10_000L
        const val PAIRING_TIMEOUT = 30_000L
    }
}
