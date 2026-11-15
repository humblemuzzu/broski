package com.muzammil.broski.feature.workspace.terminal

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.unit.dp
import androidx.core.content.res.ResourcesCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.TerminalRoute
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.lastComponent
import com.muzammil.broski.feature.workspace.sentence
import kotlinx.coroutines.launch

/** One terminal of a Mac, full size, with the keys a phone lacks docked above the keyboard. */
@Composable
fun TerminalScreen(context: FeatureContext, route: TerminalRoute) {
    MachineGate(context.phone, route.machineId) { machine, machineState ->
        val terminal = viewModel(key = "terminal:${route.machineId}:${route.terminalId}") {
            TerminalViewModel { machine.terminal(route.terminalId) }
        }
        val client = remember(machine) { WorkspaceClient(machine::request) }
        val state by terminal.state.collectAsStateWithLifecycle()
        val keyboard = remember(terminal) { TerminalKeyboard(terminal) }
        val snackbar = remember { SnackbarHostState() }
        val clipboard = rememberTerminalClipboard(terminal, snackbar)
        val scope = rememberCoroutineScope()
        val resources = LocalResources.current
        var closing by rememberSaveable { mutableStateOf(false) }
        Scaffold(
            topBar = {
                PathTopBar(lastComponent(route.cwd), route.cwd, context.back) {
                    TerminalMenu(onCopyAll = clipboard.copyAll, onClose = { closing = true })
                }
            },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            Column(Modifier.padding(padding).consumeWindowInsets(padding).imePadding().fillMaxSize()) {
                MachineBanner(machineState)
                TerminalBody(terminal, keyboard, clipboard, state, Modifier.weight(1f))
                if (state == TerminalState.Live) AccessoryRow(keyboard, onPaste = clipboard.paste)
            }
        }
        if (closing) {
            CloseTerminalDialog(
                onClose = {
                    closing = false
                    scope.launch {
                        when (val answer = client.closeTerminal(route.terminalId)) {
                            is Answer.Done -> context.back()
                            is Answer.Failed -> snackbar.showSnackbar(answer.failure.sentence(resources))
                        }
                    }
                },
                onDismiss = { closing = false },
            )
        }
        clipboard.UnsafePasteDialog()
    }
}

@Composable
private fun TerminalBody(
    terminal: TerminalViewModel,
    keyboard: TerminalKeyboard,
    clipboard: TerminalClipboard,
    state: TerminalState,
    modifier: Modifier,
) {
    val context = LocalContext.current
    val typeface = remember { requireNotNull(ResourcesCompat.getFont(context, R.font.jetbrains_mono)) }
    var fontSize by rememberSaveable { mutableFloatStateOf(DEFAULT_FONT_SIZE) }
    var selecting by rememberSaveable { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val screen by terminal.screen.collectAsStateWithLifecycle()
    LaunchedEffect(state) { if (state == TerminalState.Live) focus.requestFocus() }
    Box(modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerLowest)) {
        TerminalCanvas(
            terminal = terminal,
            keyboard = keyboard,
            typeface = typeface,
            fontSize = fontSize,
            focus = focus,
            callbacks = TerminalCanvasCallbacks(onFontSize = { fontSize = it }, onSelected = { selecting = true }),
            modifier = Modifier.fillMaxSize().padding(horizontal = 10.dp, vertical = 6.dp),
        )
        SelectionBar(
            visible = selecting,
            onCopy = {
                selecting = false
                clipboard.copySelection()
            },
            onCancel = {
                selecting = false
                terminal.clearSelection()
            },
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp),
        )
        if (!screen.scrollback.atBottom) {
            JumpToBottom(terminal::scrollToBottom, Modifier.align(Alignment.BottomEnd).padding(16.dp))
        }
        when (state) {
            TerminalState.Live -> Unit
            is TerminalState.Exited -> EndedBanner(state, Modifier.align(Alignment.BottomCenter))
            is TerminalState.Failed -> EndedBanner(state, Modifier.align(Alignment.BottomCenter))
        }
    }
}

private const val DEFAULT_FONT_SIZE = 13f
