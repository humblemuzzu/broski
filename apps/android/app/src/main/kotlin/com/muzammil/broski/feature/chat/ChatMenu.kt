package com.muzammil.broski.feature.chat

import android.content.ClipData
import android.content.Context
import android.content.res.Resources
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.Clipboard
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.core.SessionMark
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.header.SessionMenuActions
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Puts a value on the clipboard with the haptic that says it is there, and [copy]'s `confirmation` in
 * the snackbar. A value too large for the system's clipboard is refused with a `RuntimeException`
 * (a `TransactionTooLargeException` within); that is said, never thrown.
 */
class ChatCopier(
    private val clipboard: Clipboard,
    private val haptics: HapticFeedback,
    private val snackbar: SnackbarHostState,
    private val resources: Resources,
    private val scope: CoroutineScope,
) {
    fun copy(label: String, value: String, confirmation: String? = null) {
        scope.launch {
            try {
                clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(label, value)))
            } catch (error: CancellationException) {
                throw error
            } catch (_: RuntimeException) {
                haptics.perform(Haptic.Failure)
                snackbar.showSnackbar(resources.getString(R.string.chat_copy_too_large))
                return@launch
            }
            haptics.perform(Haptic.Success)
            confirmation?.let { snackbar.showSnackbar(it) }
        }
    }
}

@Composable
fun rememberChatCopier(snackbar: SnackbarHostState): ChatCopier {
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    return remember(clipboard, haptics, snackbar, resources, scope) { ChatCopier(clipboard, haptics, snackbar, resources, scope) }
}

/** Where the overflow leads in the session's folder; `null` while the session names no folder. */
class FolderLinks(val files: () -> Unit, val changes: () -> Unit, val terminal: () -> Unit)

/** The overflow's actions for the chat's session, each wired to what does it. */
@Composable
fun sessionMenuActions(
    model: ChatViewModel,
    dialogs: ChatDialogs,
    snackbar: SnackbarHostState,
    copier: ChatCopier,
    folder: FolderLinks?,
    openModel: () -> Unit,
    openInfo: () -> Unit,
): SessionMenuActions {
    val header by model.header.collectAsStateWithLifecycle()
    val live by model.live.collectAsStateWithLifecycle()
    val catalog by model.catalog.catalog.collectAsStateWithLifecycle()
    val pinned by model.phone.pinned.collectAsStateWithLifecycle()
    val muted by model.phone.muted.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    val key = model.sessionKey
    val backend = catalog.capabilities
    val title = header.title ?: resources.getString(R.string.inbox_untitled)
    val canPickModel = live.capabilities?.controllable == true && (catalog.models.isNotEmpty() || catalog.modes.isNotEmpty())
    return SessionMenuActions(
        openFiles = folder?.files,
        openChanges = folder?.changes,
        openTerminal = folder?.terminal,
        openModel = openModel.takeIf { canPickModel },
        pinned = key in pinned,
        togglePin = { model.phone.setMarked(SessionMark.Pinned, key, key !in pinned) },
        rename = dialogs.rename.takeIf { backend?.rename == true },
        markUnread = model::markUnread.takeIf { header.settled },
        muted = key in muted,
        toggleMute = { model.phone.setMarked(SessionMark.Muted, key, key !in muted) },
        compact = model.actions::compact.takeIf { live.capabilities?.compact == true },
        fork = model.actions::fork.takeIf { backend?.fork == true },
        shareMarkdown = { share(scope, context, snackbar, title, model.conversationText()) },
        copyConversation = { copier.copy(title, model.conversationText()) },
        sessionInfo = openInfo,
        delete = dialogs.delete.takeIf { backend?.delete == true },
    )
}

/** Shares the conversation, saying so in the snackbar when no app took it or its file could not be written. */
private fun share(scope: CoroutineScope, context: Context, snackbar: SnackbarHostState, subject: String, text: String) {
    scope.launch {
        val shared = try {
            shareConversation(context, subject, text)
            true
        } catch (error: CancellationException) {
            throw error
        } catch (_: RuntimeException) {
            false
        } catch (_: IOException) {
            false
        }
        if (!shared) snackbar.showSnackbar(context.getString(R.string.chat_share_failed))
    }
}
