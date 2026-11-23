package com.muzammil.broski.feature.chat

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.SessionRoute
import com.muzammil.broski.design.EmptyState
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.composer.ImageAttachments
import com.muzammil.broski.feature.chat.header.DeleteDialog
import com.muzammil.broski.feature.chat.header.RenameDialog
import com.muzammil.broski.feature.chat.work.DiffSheet
import com.muzammil.broski.feature.chat.work.TextPage
import com.muzammil.broski.feature.chat.work.TextSheet
import com.muzammil.broski.feature.notifications.Notifications
import com.muzammil.broski.feature.notifications.SessionTarget
import uniffi.broski_contract.FileChange
import uniffi.broski_core.ClientException
import uniffi.broski_core.ViewEnd

/** The chat for [route]: its view model for as long as the entry is on the back stack, then the screen. */
@Composable
fun ChatScreen(context: FeatureContext, route: SessionRoute) {
    val machine = context.phone.machine(route.machineId)
    if (machine == null) {
        EmptyState(stringResource(R.string.chat_not_paired_title), stringResource(R.string.chat_not_paired_body))
        return
    }
    val resolver = LocalContext.current.applicationContext.contentResolver
    val visibleTarget = remember(route.machineId, route.backend, route.sessionId) {
        SessionTarget(route.machineId, route.backend, route.sessionId)
    }
    DisposableEffect(visibleTarget) {
        Notifications.setVisibleSession(visibleTarget)
        onDispose {
            if (Notifications.visibleForegroundSession() == visibleTarget) {
                Notifications.setVisibleSession(null)
            }
        }
    }
    val model = viewModel(key = "chat:${route.machineId}:${route.backend}:${route.sessionId}") {
        ChatViewModel(context.phone, route.machineId, route.session, machine, ImageAttachments(resolver))
    }
    val snackbar = remember { SnackbarHostState() }
    var diff by remember { mutableStateOf<FileChange?>(null) }
    var page by remember { mutableStateOf<TextPage?>(null) }
    var renaming by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    Events(model, context, snackbar)
    val header by model.header.collectAsStateWithLifecycle()
    ChatLayout(
        model = model,
        context = context,
        snackbar = snackbar,
        dialogs = ChatDialogs(openDiff = { diff = it }, openText = { page = it }, rename = { renaming = true }, delete = { deleting = true }),
    )
    val title = header.title ?: stringResource(R.string.inbox_untitled)
    if (renaming) RenameDialog(title, onRename = { renaming = false; model.actions.rename(it) }, onDismiss = { renaming = false })
    if (deleting) {
        DeleteDialog(header.agent.name, header.machineName, onDelete = { deleting = false; model.actions.delete() }, onDismiss = { deleting = false })
    }
    diff?.let { change -> DiffSheet(change) { diff = null } }
    page?.let { shown -> TextSheet(shown) { page = null } }
}

/** What the layout opens over itself. */
class ChatDialogs(val openDiff: (FileChange) -> Unit, val openText: (TextPage) -> Unit, val rename: () -> Unit, val delete: () -> Unit)

/** The view model's one-off events: their haptic, their words in the snackbar, and where they lead. */
@Composable
private fun Events(model: ChatViewModel, context: FeatureContext, snackbar: SnackbarHostState) {
    val haptics = LocalHapticFeedback.current
    val resources = LocalResources.current
    val live by model.live.collectAsStateWithLifecycle()
    LaunchedEffect(live.ended) {
        if (live.ended is ViewEnd.Removed) context.back()
    }
    LaunchedEffect(model) {
        model.events.collect { event ->
            val words = when (event) {
                ChatEvent.Deleted -> {
                    haptics.perform(Haptic.Warning)
                    context.back()
                    null
                }
                ChatEvent.LeftUnread -> {
                    context.back()
                    null
                }
                is ChatEvent.OpenSession -> {
                    context.navigate(SessionRoute.of(model.machineId, event.session))
                    null
                }
                ChatEvent.AnsweredElsewhere -> resources.getString(R.string.card_answered_elsewhere)
                ChatEvent.ImageTooLarge -> resources.getString(R.string.composer_image_too_large)
                ChatEvent.NoImageToPaste -> resources.getString(R.string.composer_no_image_to_paste)
                is ChatEvent.Refused -> resources.getString(R.string.chat_refused, event.detail)
                is ChatEvent.Failed -> resources.getString(failure(event))
            }
            if (words != null) {
                if (event !is ChatEvent.AnsweredElsewhere) haptics.perform(Haptic.Failure) else haptics.perform(Haptic.Warning)
                snackbar.showSnackbar(words)
            }
        }
    }
}

private fun failure(event: ChatEvent.Failed): Int = when (event.error) {
    is ClientException.Timeout -> R.string.chat_failed_timeout
    is ClientException.Overloaded -> R.string.chat_failed_busy
    else -> R.string.chat_failed_offline
}
