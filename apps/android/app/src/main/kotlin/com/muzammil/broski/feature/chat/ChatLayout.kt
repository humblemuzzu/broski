package com.muzammil.broski.feature.chat

import android.content.ClipData
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FilesRoute
import com.muzammil.broski.app.SessionRoute
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.animationsEnabled
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.header.ChatTopBar
import com.muzammil.broski.feature.chat.header.SessionMenu
import com.muzammil.broski.feature.chat.header.SessionMenuActions
import com.muzammil.broski.feature.chat.transcript.TranscriptCallbacks
import com.muzammil.broski.feature.chat.transcript.TranscriptList
import com.muzammil.broski.feature.chat.transcript.TranscriptState
import com.muzammil.broski.feature.chat.transcript.laneStatus
import com.muzammil.broski.feature.chat.transcript.rememberTranscriptState
import com.muzammil.broski.feature.chat.work.WorkActions
import kotlinx.coroutines.launch

private const val OFFLINE_ALPHA = 0.55f

/**
 * The chat, bottom to top: the composer and what is pinned above it, the transcript running full
 * bleed under both and under the header, and the header. The transcript's padding follows the
 * measured bars, so the conversation rides up with the keyboard.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ChatLayout(model: ChatViewModel, context: FeatureContext, snackbar: SnackbarHostState, dialogs: ChatDialogs) {
    val density = LocalDensity.current
    val rows by model.rows.collectAsStateWithLifecycle()
    val live by model.live.collectAsStateWithLifecycle()
    val header by model.header.collectAsStateWithLifecycle()
    val revealed by model.revealed.collectAsStateWithLifecycle()
    val images by model.images.images.collectAsStateWithLifecycle()
    val transcript = rememberTranscriptState(rememberLazyListState())
    var topHeight by remember { mutableIntStateOf(0) }
    var bottomHeight by remember { mutableIntStateOf(0) }
    val online = header.health?.isOnline != false
    val shown by animateFloatAsState(if (revealed) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "reveal")
    val callbacks = remember(model) {
        TranscriptCallbacks(
            requestImage = model.images::request,
            loadOlder = model.feed::loadOlder,
            work = WorkActions(dialogs.openDiff) { session -> context.navigate(SessionRoute.of(model.machineId, session)) },
        )
    }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        TranscriptList(
            rows = rows,
            lane = laneStatus(live.snapshot),
            images = images,
            state = transcript,
            callbacks = callbacks,
            contentPadding = with(density) { PaddingValues(top = topHeight.toDp() + 8.dp, bottom = bottomHeight.toDp() + 8.dp) },
            modifier = Modifier.alpha(shown * if (online) 1f else OFFLINE_ALPHA),
        )
        if (!revealed) LoadingIndicator(Modifier.align(Alignment.Center).size(48.dp))
        Header(model, context, dialogs, transcript.scrolledUnderTop, Modifier.align(Alignment.TopCenter).onSizeChanged { topHeight = it.height })
        ChatBottom(model, dialogs.openDiff, Modifier.align(Alignment.BottomCenter).onSizeChanged { bottomHeight = it.height })
        val bottom = with(density) { bottomHeight.toDp() }
        JumpToLatest(transcript, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = bottom + 12.dp))
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = bottom))
    }
}

@Composable
private fun Header(model: ChatViewModel, context: FeatureContext, dialogs: ChatDialogs, scrolledUnder: Boolean, modifier: Modifier) {
    val header by model.header.collectAsStateWithLifecycle()
    val live by model.live.collectAsStateWithLifecycle()
    val catalog by model.catalog.catalog.collectAsStateWithLifecycle()
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var menuOpen by remember { mutableStateOf(false) }
    val backend = catalog.capabilities
    val session = live.capabilities
    val usage = live.snapshot.usage
    val window = usage?.contextWindow ?: catalog.model(live.snapshot.modelId)?.contextWindow
    val actions = SessionMenuActions(
        fork = model.actions::fork.takeIf { backend?.fork == true },
        rename = dialogs.rename.takeIf { backend?.rename == true },
        delete = dialogs.delete.takeIf { backend?.delete == true },
        compact = model.actions::compact.takeIf { session?.compact == true },
        copyConversation = {
            val text = model.conversationText()
            scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(header.title ?: "", text))) }
        },
    )
    ChatTopBar(
        header = header,
        runStartedAt = live.snapshot.run?.startedAt,
        contextUsed = usage?.contextTokens?.let { used -> window?.let { (used.toFloat() / it).coerceIn(0f, 1f) } },
        scrolledUnder = scrolledUnder,
        onBack = context.back,
        onRename = dialogs.rename.takeIf { backend?.rename == true },
        onOpenFiles = header.cwd?.let { cwd -> { context.navigate(FilesRoute(model.machineId, cwd)) } },
        menu = { dismiss -> SessionMenu(menuOpen, actions, dismiss) },
        menuOpen = menuOpen,
        onMenu = { menuOpen = it },
        modifier = modifier,
    )
}

/** "Jump to latest" while the person reads further up, with how many messages came since. */
@Composable
private fun JumpToLatest(state: TranscriptState, modifier: Modifier) {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val animate = animationsEnabled()
    AnimatedVisibility(!state.follow.following, modifier, enter = scaleIn() + fadeIn(), exit = scaleOut() + fadeOut()) {
        JumpButton(state.follow.unseen) {
            haptics.perform(Haptic.SnapToLatest)
            scope.launch { state.jump(animate) }
        }
    }
}
