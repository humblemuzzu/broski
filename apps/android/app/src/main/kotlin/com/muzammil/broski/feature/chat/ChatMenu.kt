package com.muzammil.broski.feature.chat

import android.content.ClipData
import android.content.Context
import android.content.Intent
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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Puts a value on the clipboard with the haptic that says it is there, then does [copy]'s `after`. */
class ChatCopier(private val clipboard: Clipboard, private val haptics: HapticFeedback, private val scope: CoroutineScope) {
    fun copy(label: String, value: String, after: suspend () -> Unit = {}) {
        scope.launch {
            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(label, value)))
            haptics.perform(Haptic.Success)
            after()
        }
    }
}

@Composable
fun rememberChatCopier(): ChatCopier {
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    return remember(clipboard, haptics, scope) { ChatCopier(clipboard, haptics, scope) }
}

/** The overflow's actions for the chat's session, each wired to what does it. */
@Composable
fun sessionMenuActions(model: ChatViewModel, dialogs: ChatDialogs, snackbar: SnackbarHostState, copier: ChatCopier, openInfo: () -> Unit): SessionMenuActions {
    val header by model.header.collectAsStateWithLifecycle()
    val live by model.live.collectAsStateWithLifecycle()
    val catalog by model.catalog.catalog.collectAsStateWithLifecycle()
    val pinned by model.phone.pinned.collectAsStateWithLifecycle()
    val muted by model.phone.muted.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val resources = LocalResources.current
    val key = model.sessionKey
    val backend = catalog.capabilities
    val title = header.title ?: resources.getString(R.string.inbox_untitled)
    return SessionMenuActions(
        pinned = key in pinned,
        togglePin = { model.phone.setMarked(SessionMark.Pinned, key, key !in pinned) },
        rename = dialogs.rename.takeIf { backend?.rename == true },
        copySessionId = {
            val id = key.sessionId
            copier.copy(resources.getString(R.string.info_session_id), id) { snackbar.showSnackbar(resources.getString(R.string.chat_session_id_copied)) }
        },
        markUnread = model::markUnread.takeIf { header.settled },
        muted = key in muted,
        toggleMute = { model.phone.setMarked(SessionMark.Muted, key, key !in muted) },
        compact = model.actions::compact.takeIf { live.capabilities?.compact == true },
        fork = model.actions::fork.takeIf { backend?.fork == true },
        shareMarkdown = { shareText(context, title, model.conversationText()) },
        copyConversation = { copier.copy(title, model.conversationText()) },
        sessionInfo = openInfo,
        delete = dialogs.delete.takeIf { backend?.delete == true },
    )
}

private fun shareText(context: Context, subject: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, subject)
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(send, subject))
}
