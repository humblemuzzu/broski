package com.muzammil.broski.feature.workspace.terminal

import android.content.ClipData
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
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.unit.dp
import androidx.core.content.res.ResourcesCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.TerminalRoute
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.lastComponent
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
                    context.back()
                    clipboard.scope.launch { client.closeTerminal(route.terminalId) }
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

/** Copy and paste between the phone's clipboard and the terminal, with a word before a paste that would run commands. */
class TerminalClipboard internal constructor(
    val scope: kotlinx.coroutines.CoroutineScope,
    val paste: () -> Unit,
    val copyAll: () -> Unit,
    val copySelection: () -> Unit,
    private val unsafe: androidx.compose.runtime.MutableState<String?>,
    private val terminal: TerminalViewModel,
) {
    @Composable
    fun UnsafePasteDialog() {
        val text = unsafe.value ?: return
        UnsafePasteDialog(text, onPaste = {
            unsafe.value = null
            terminal.paste(text)
        }, onDismiss = { unsafe.value = null })
    }
}

@Composable
private fun rememberTerminalClipboard(terminal: TerminalViewModel, snackbar: SnackbarHostState): TerminalClipboard {
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val resources = LocalResources.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val unsafe = rememberSaveable { mutableStateOf<String?>(null) }
    return remember(terminal) {
        fun copy(text: String?) = scope.launch {
            if (text.isNullOrEmpty()) return@launch
            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(resources.getString(R.string.terminal_title), text)))
            haptics.perform(Haptic.Success)
            snackbar.showSnackbar(resources.getString(R.string.terminal_copied))
        }
        TerminalClipboard(
            scope = scope,
            paste = {
                scope.launch {
                    val text = clipboard.getClipEntry()?.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                    if (text.isNullOrEmpty()) return@launch
                    if (terminal.isPasteSafe(text)) terminal.paste(text) else unsafe.value = text
                }
            },
            copyAll = { scope.launch { copy(terminal.text()) } },
            copySelection = { scope.launch { copy(terminal.takeSelection()) } },
            unsafe = unsafe,
            terminal = terminal,
        )
    }
}

private const val DEFAULT_FONT_SIZE = 13f
