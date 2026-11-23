package com.muzammil.broski.feature.newsession

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.GlassCircleButton
import com.muzammil.broski.design.GlassMetrics
import com.muzammil.broski.design.SoftTopBar
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.SessionRoute
import com.muzammil.broski.core.Agent
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.ChatScreen
import com.muzammil.broski.feature.chat.composer.Catalog
import com.muzammil.broski.feature.chat.composer.Composer
import com.muzammil.broski.feature.chat.composer.ComposerActions
import com.muzammil.broski.feature.chat.composer.ComposerLook
import com.muzammil.broski.feature.chat.composer.ComposerSettings
import com.muzammil.broski.feature.chat.composer.FileMentionPopup
import com.muzammil.broski.feature.chat.composer.ImageAttachments
import com.muzammil.broski.feature.chat.composer.SettingActions
import com.muzammil.broski.feature.chat.composer.dictation.DictationHook
import com.muzammil.broski.feature.chat.composer.dictation.LocalDictation
import com.muzammil.broski.feature.chat.composer.sendButton
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.lastComponent
import uniffi.broski_contract.AttachmentKind
import uniffi.broski_contract.PromptMode

/**
 * New session, laid out as the chat it becomes: the question where the transcript will be, and above the
 * composer the folders this Mac's sessions ran in, with the agent and the folder as two pills. Send
 * creates the session and the screen turns into its chat in place, the first message already on its way.
 */
@Composable
fun NewSessionScreen(context: FeatureContext) {
    var created by rememberSaveable(stateSaver = CreatedSaver) { mutableStateOf<SessionRoute?>(null) }
    Crossfade(created, label = "becomes the chat") { route ->
        if (route != null) {
            ChatScreen(context, route)
        } else {
            val resolver = LocalContext.current.applicationContext.contentResolver
            val model = viewModel { NewSessionViewModel(context.phone, ImageAttachments(resolver)) }
            NewSessionContent(model, context) { created = it }
        }
    }
}

/** The session it became, kept through process death so the screen comes back as that chat. */
private val CreatedSaver = Saver<SessionRoute?, List<String>>(
    save = { route -> route?.let { listOf(it.machineId, it.backend, it.sessionId) } },
    restore = { (machineId, backend, sessionId) -> SessionRoute(machineId, backend, sessionId) },
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewSessionContent(model: NewSessionViewModel, context: FeatureContext, created: (SessionRoute) -> Unit) {
    val ui by model.state.collectAsStateWithLifecycle()
    var error by remember { mutableStateOf<String?>(null) }
    var showsProjects by rememberSaveable { mutableStateOf(true) }
    var browsing by rememberSaveable { mutableStateOf(false) }
    Outcomes(model, created) { error = it }
    Column(Modifier.fillMaxSize().background(BroskiTheme.semantic.canvas)) {
        SoftTopBar(BroskiTheme.semantic.canvas) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                GlassCircleButton(R.drawable.ic_chevron_left, stringResource(R.string.action_back), context.back)
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { Title(ui, model::pickMachine) }
                Spacer(Modifier.size(GlassMetrics.control))
            }
        }
        ui.machine?.let { MachineBanner(it) }
        Hero(ui.agent, Modifier.weight(1f).fillMaxWidth())
        Bottom(model, ui, error, showsProjects, onShowProjects = { showsProjects = it }, onBrowse = { browsing = true })
    }
    val machineId = ui.choice.machineId
    val machine = machineId?.let(context.phone::machine)
    if (browsing && machineId != null && machine != null) {
        val haptics = LocalHapticFeedback.current
        ProjectsSheet(machine, machineId, ui.projects, ui.choice.folder, ui.home, onPick = { folder ->
            haptics.perform(Haptic.PickerStep)
            model.pickFolder(folder)
            browsing = false
            showsProjects = false
        }, onDismiss = { browsing = false })
    }
}

/** What a send came to: the chat it opens, or why not in words over the composer. */
@Composable
private fun Outcomes(model: NewSessionViewModel, created: (SessionRoute) -> Unit, onError: (String) -> Unit) {
    val resources = LocalResources.current
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(model) {
        model.outcomes.collect { outcome ->
            when (outcome) {
                is NewSessionEvent.Created -> created(SessionRoute.of(outcome.machineId, outcome.session))
                is NewSessionEvent.Refused -> onError(resources.getString(R.string.new_session_refused, outcome.rejection.message))
                is NewSessionEvent.Failed -> onError(resources.getString(R.string.chat_failed_offline))
                NewSessionEvent.ImageTooLarge -> onError(resources.getString(R.string.composer_image_too_large))
                NewSessionEvent.NoImageToPaste -> onError(resources.getString(R.string.composer_no_image_to_paste))
            }
            if (outcome !is NewSessionEvent.Created) haptics.perform(Haptic.Failure)
        }
    }
}

/** "New session" over the folder, and over the Mac too when several are paired, which is then a menu to start on another. */
@Composable
private fun Title(ui: NewSessionUi, onMachine: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val several = ui.machines.size > 1
    val folder = ui.choice.folder?.let(::lastComponent) ?: stringResource(R.string.new_session_pick_folder)
    Box {
        Column(
            Modifier.widthIn(max = 260.dp).clip(RoundedCornerShape(12.dp)).then(if (several) Modifier.clickable { open = true } else Modifier).padding(horizontal = 4.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(stringResource(R.string.new_session), fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.semantics { heading() })
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (several) "$folder · ${ui.machine?.name.orEmpty()}" else folder,
                    fontSize = 12.sp,
                    lineHeight = 15.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (several) {
                    Icon(
                        painterResource(R.drawable.ic_keyboard_arrow_down),
                        contentDescription = stringResource(R.string.new_session_pick_machine),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            ui.machines.forEach { machine ->
                DropdownMenuItem(
                    text = { Text(machine.name) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_computer), contentDescription = null) },
                    trailingIcon = if (machine.id == ui.choice.machineId) ({ Icon(painterResource(R.drawable.ic_check), contentDescription = null) }) else null,
                    onClick = {
                        open = false
                        onMachine(machine.id)
                    },
                )
            }
        }
    }
}

/** Where the transcript will be: the agent's mark and the question, left out when the keyboard and the folders leave no room. */
@Composable
private fun Hero(agent: Agent?, modifier: Modifier) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        if (maxHeight >= HERO_MIN_HEIGHT) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            AnimatedContent(agent, transitionSpec = { (fadeIn() + scaleIn(initialScale = 0.8f)) togetherWith fadeOut() }, label = "agent") { agent ->
                if (agent != null) {
                    AgentMark(agent, size = 36.dp)
                } else {
                    Image(painterResource(R.drawable.broski_icon), contentDescription = null, modifier = Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)))
                }
            }
            Text(
                stringResource(R.string.new_session_question),
                fontSize = 22.sp,
                lineHeight = 28.sp,
                fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
        }
    }
}

@Composable
private fun Bottom(
    model: NewSessionViewModel,
    ui: NewSessionUi,
    error: String?,
    showsProjects: Boolean,
    onShowProjects: (Boolean) -> Unit,
    onBrowse: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val focusManager = LocalFocusManager.current
    val focus = remember { FocusRequester() }
    Column(
        Modifier.fillMaxWidth().imePadding().navigationBarsPadding().padding(start = 12.dp, end = 12.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        error?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 12.dp))
        }
        AnimatedVisibility(showsProjects, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            ProjectCard(ui.projects.take(RECENT_SHOWN), ui.choice.folder, ui.home, onPick = { folder ->
                haptics.perform(Haptic.PickerStep)
                model.pickFolder(folder)
                onShowProjects(false)
                focus.requestFocus()
            }, onBrowse = onBrowse)
        }
        val machine = ui.machine ?: return@Column
        SessionPills(
            agents = ui.agents,
            chosen = ui.agent,
            machineName = machine.name,
            folder = ui.choice.folder,
            showsProjects = showsProjects,
            onAgent = { backend ->
                haptics.perform(Haptic.PickerStep)
                model.pickAgent(backend)
            },
            onFolder = {
                focusManager.clearFocus()
                onShowProjects(!showsProjects)
            },
        )
        NewSessionComposer(model, ui, focus, Modifier.onFocusChanged { if (it.hasFocus) onShowProjects(false) }) {
            focusManager.clearFocus()
            onShowProjects(true)
        }
    }
}

/** Send with no folder yet opens the folders instead: a session needs somewhere to run. */
@Composable
private fun NewSessionComposer(model: NewSessionViewModel, ui: NewSessionUi, focus: FocusRequester, modifier: Modifier, onNoFolder: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val catalog: Catalog by model.catalog.collectAsStateWithLifecycle()
    val command by model.composer.command.collectAsStateWithLifecycle()
    val images by model.composer.images.collectAsStateWithLifecycle()
    val choice = ui.choice
    val ready = ui.machine?.health?.isOnline == true && choice.backend != null && !ui.creating
    val hasInput = model.composer.input.text.isNotBlank() || command != null || images.isNotEmpty()
    val folder = choice.folder
    val actions = remember(model, folder) {
        ComposerActions(
            onPress = {
                if (folder == null) {
                    onNoFolder()
                } else {
                    haptics.perform(Haptic.Send)
                    model.create()
                }
            },
            onImage = model::attachImage,
            onNoImage = model::noImageToPaste,
            settings = SettingActions(model::pickModel, model::pickThinking, model::pickMode),
        )
    }
    val dictation = LocalDictation.current
    val hook = remember(dictation, model) { dictation?.let { DictationHook(it, model.dictationTarget(it), openVoiceSettings = null) } }
    val text = model.composer.input.text.toString()
    val selection = model.composer.input.selection
    FileMentionPopup(
        text = text,
        cursor = if (selection.collapsed) selection.end else null,
        commandActive = command == null && text.startsWith("/") && !text.contains(' ') && !text.contains('\n'),
        root = folder,
        search = model::searchFiles,
        onPick = model.composer::pickFile,
    )
    Composer(
        state = model.composer,
        command = command,
        images = images,
        look = ComposerLook(
            placeholder = stringResource(R.string.composer_placeholder),
            button = sendButton(running = false, hasInput = hasInput, modes = listOf(PromptMode.START), controllable = ready),
            images = catalog.capabilities?.attachments?.contains(AttachmentKind.IMAGE) == true,
            settings = ComposerSettings(choice.backend, catalog.models, choice.modelId, choice.thinking, catalog.modes, choice.modes),
        ),
        actions = actions,
        modifier = modifier,
        focus = focus,
        dictation = hook,
    )
}

private const val RECENT_SHOWN = 5

private val HERO_MIN_HEIGHT = 140.dp
