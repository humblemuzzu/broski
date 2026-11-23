package com.muzammil.broski.feature.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FileRoute
import com.muzammil.broski.app.FilesRoute
import com.muzammil.broski.app.GitRoute
import com.muzammil.broski.app.SessionRoute
import com.muzammil.broski.app.VoiceRoute
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.chatCanvas
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.LoadingOrb
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.animationsEnabled
import com.muzammil.broski.design.format.FormatLinks
import com.muzammil.broski.design.format.LocalFormatLinks
import com.muzammil.broski.design.label
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.header.ChatTopBar
import com.muzammil.broski.feature.chat.header.SessionMenu
import com.muzammil.broski.feature.chat.header.SessionInfoSheet
import com.muzammil.broski.feature.chat.header.sessionInfo
import com.muzammil.broski.feature.chat.transcript.LocalModelNames
import com.muzammil.broski.feature.chat.transcript.TranscriptCallbacks
import com.muzammil.broski.feature.chat.transcript.TranscriptList
import com.muzammil.broski.feature.chat.transcript.TranscriptState
import com.muzammil.broski.feature.chat.transcript.rememberTranscriptState
import com.muzammil.broski.feature.chat.work.WorkActions
import com.muzammil.broski.feature.images.ImageLightbox
import com.muzammil.broski.feature.images.ImageTarget
import com.muzammil.broski.feature.images.LightboxRequest
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.sentence
import com.muzammil.broski.feature.workspace.terminal.rememberTerminalOpener
import kotlinx.coroutines.launch
import uniffi.broski_core.isImagePath

/**
 * The chat, bottom to top: the composer and what is pinned above it, the transcript running full
 * bleed under both and under the header, and the header. The transcript's padding follows the
 * measured bars, so the conversation rides up with the keyboard. A Mac out of reach says so in the
 * header; it never dims the conversation.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ChatLayout(model: ChatViewModel, context: FeatureContext, snackbar: SnackbarHostState, dialogs: ChatDialogs) {
    val density = LocalDensity.current
    val header by model.header.collectAsStateWithLifecycle()
    val revealed by model.revealed.collectAsStateWithLifecycle()
    val history by model.feed.history.collectAsStateWithLifecycle()
    val transcript = rememberTranscriptState(rememberLazyListState())
    var topHeight by remember { mutableIntStateOf(0) }
    var bottomHeight by remember { mutableIntStateOf(0) }
    var lightbox by remember { mutableStateOf<LightboxRequest?>(null) }
    val jumps by model.jumps.collectAsStateWithLifecycle()
    var handledJumps by rememberSaveable { mutableIntStateOf(jumps) }
    val animate = animationsEnabled()
    LaunchedEffect(jumps) {
        if (jumps == handledJumps) return@LaunchedEffect
        handledJumps = jumps
        transcript.jump(animate)
    }
    val shown by animateFloatAsState(if (revealed) 1f else 0f, MaterialTheme.motionScheme.defaultEffectsSpec(), label = "reveal")
    val openImages: (List<ImageTarget>, Int) -> Unit = remember(model) {
        { items, index ->
            lightbox = LightboxRequest(
                items = items,
                initialIndex = index,
                thumbnail = model.images::cachedThumbnail,
                loadFull = model.images::loadFull,
            )
        }
    }
    val openResolvedPath: (String, Int?) -> Unit = remember(model, context, openImages) {
        { rawPath, line ->
            val resolved = resolvePath(model.header.value.cwd, rawPath)
            if (isImagePath(resolved)) {
                openImages(listOf(ImageTarget.File(resolved, null)), 0)
            } else {
                context.navigate(FileRoute(model.machineId, resolved, line))
            }
        }
    }
    val callbacks = remember(model, openImages, openResolvedPath) {
        TranscriptCallbacks(
            openImages = openImages,
            loadOlder = model.feed::loadOlder,
            work = WorkActions(
                openDiff = dialogs.openDiff,
                openSession = { session -> context.navigate(SessionRoute.of(model.machineId, session)) },
                openText = dialogs.openText,
                openFile = { path -> openResolvedPath(path, null) },
                openFileAt = openResolvedPath,
                imageStore = model.images,
                openImages = openImages,
            ),
        )
    }
    val links = remember(callbacks) { FormatLinks(callbacks.work.openFileAt) }
    val openVoiceSettings = remember(context) { { context.navigate(VoiceRoute) } }
    lightbox?.let { request -> ImageLightbox(request) { lightbox = null } }
    val catalog by model.catalog.catalog.collectAsStateWithLifecycle()
    val names: (String) -> String = remember(catalog) { { id -> catalog.models.firstOrNull { it.id == id }?.displayName ?: id } }
    Box(Modifier.fillMaxSize().background(chatCanvas)) {
        CompositionLocalProvider(LocalFormatLinks provides links, LocalModelNames provides names) {
            TranscriptSection(
                model = model,
                state = transcript,
                callbacks = callbacks,
                contentPadding = with(density) { PaddingValues(top = topHeight.toDp() + 8.dp, bottom = bottomHeight.toDp() + 8.dp) },
                modifier = Modifier.alpha(shown),
            )
        }
        if (!revealed || !history.loaded) {
            val connection = header.health?.takeUnless { it.isOnline }?.label(header.machineName)
            Loading(connection, Modifier.align(Alignment.Center).padding(horizontal = 32.dp))
        }
        Header(model, context, dialogs, snackbar, Modifier.align(Alignment.TopCenter).onSizeChanged { topHeight = it.height })
        ChatBottom(model, dialogs.openDiff, openVoiceSettings, Modifier.align(Alignment.BottomCenter).onSizeChanged { bottomHeight = it.height })
        val bottom = with(density) { bottomHeight.toDp() }
        JumpToLatest(transcript, Modifier.align(Alignment.BottomCenter).padding(bottom = bottom + 12.dp))
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = bottom))
    }
}

/** Isolates 60 Hz streaming row updates from the header, composer, and overlays. */
@Composable
private fun TranscriptSection(
    model: ChatViewModel,
    state: TranscriptState,
    callbacks: TranscriptCallbacks,
    contentPadding: PaddingValues,
    modifier: Modifier,
) {
    val rows by model.rows.collectAsStateWithLifecycle()
    val lane by model.lane.collectAsStateWithLifecycle()
    TranscriptList(
        rows = rows,
        lane = lane.lane,
        runStartedAt = lane.runStartedAt,
        imageStore = model.images,
        state = state,
        callbacks = callbacks,
        contentPadding = contentPadding,
        modifier = modifier,
    )
}

@Composable
private fun Header(model: ChatViewModel, context: FeatureContext, dialogs: ChatDialogs, snackbar: SnackbarHostState, modifier: Modifier) {
    val header by model.header.collectAsStateWithLifecycle()
    val percent by model.contextPercent.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }
    var infoOpen by rememberSaveable { mutableStateOf(false) }
    val copier = rememberChatCopier(snackbar)
    val actions = sessionMenuActions(model, dialogs, snackbar, copier, folderLinks(model, context, header.cwd, snackbar)) { infoOpen = true }
    ChatTopBar(
        header = header,
        contextPercent = percent,
        onBack = context.back,
        onRename = actions.rename,
        menu = { dismiss -> SessionMenu(menuOpen, actions, percent, dismiss) },
        onMenu = { menuOpen = it },
        modifier = modifier,
    )
    if (infoOpen) {
        val live by model.live.collectAsStateWithLifecycle()
        val catalog by model.catalog.catalog.collectAsStateWithLifecycle()
        val info = sessionInfo(header, model.feed.session, live.snapshot, catalog)
        val home by produceState<String?>(null, model) {
            value = (model.workspace.info() as? Answer.Done)?.value?.roots?.firstOrNull()
        }
        SessionInfoSheet(info, home, onCopy = { label, value -> copier.copy(label, value) }, onDismiss = { infoOpen = false })
    }
}

/** The session's folder, its repository and a new terminal in it, from the overflow; `null` without a folder. */
@Composable
private fun folderLinks(model: ChatViewModel, context: FeatureContext, cwd: String?, snackbar: SnackbarHostState): FolderLinks? {
    val machine = context.phone.machine(model.machineId) ?: return null
    val resources = LocalResources.current
    val scope = rememberCoroutineScope()
    val openTerminal = rememberTerminalOpener(machine, model.machineId, context.navigate) { failure ->
        scope.launch { snackbar.showSnackbar(failure.sentence(resources)) }
    }
    cwd ?: return null
    return FolderLinks(
        files = { context.navigate(FilesRoute(model.machineId, cwd)) },
        changes = { context.navigate(GitRoute(model.machineId, cwd)) },
        terminal = { openTerminal(cwd) },
    )
}

/** What a chat shows while its first page is on its way, and why it is late when the Mac is out of reach. */
@Composable
private fun Loading(connection: String?, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (connection == null) {
            LoadingOrb(state = OrbState.CONNECTING, size = 64.dp, label = stringResource(R.string.chat_loading))
        } else {
            Orb(OrbState.CONNECTING, size = 64.dp)
            Text(
                connection,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
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

/** A path from agent text as the workspace names it: a relative one is in the session's folder. */
private fun resolvePath(cwd: String?, path: String): String = when {
    cwd == null || path.startsWith("/") || path.startsWith("~") -> path
    else -> cwd.trimEnd('/') + "/" + path.removePrefix("./")
}
