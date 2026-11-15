package com.muzammil.broski.feature.workspace.terminal

import android.content.ClipData
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import kotlinx.coroutines.launch

/** Copy and paste between the phone's clipboard and the terminal, with a word before a paste that would run commands. */
class TerminalClipboard internal constructor(
    val paste: () -> Unit,
    val copyAll: () -> Unit,
    val copySelection: () -> Unit,
    private val unsafe: MutableState<String?>,
    private val terminal: TerminalViewModel,
) {
    @Composable
    fun UnsafePasteDialog() {
        val text = unsafe.value ?: return
        UnsafePasteDialog(
            text = text,
            onPaste = {
                unsafe.value = null
                terminal.paste(text)
            },
            onDismiss = { unsafe.value = null },
        )
    }
}

@Composable
fun rememberTerminalClipboard(terminal: TerminalViewModel, snackbar: SnackbarHostState): TerminalClipboard {
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val resources = LocalResources.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val unsafe = rememberSaveable { mutableStateOf<String?>(null) }
    return remember(terminal) {
        val copy: (suspend () -> String?) -> Unit = { read ->
            scope.launch {
                val text = read()
                if (!text.isNullOrEmpty()) {
                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(resources.getString(R.string.terminal_title), text)))
                    haptics.perform(Haptic.Success)
                    snackbar.showSnackbar(resources.getString(R.string.terminal_copied))
                }
            }
        }
        TerminalClipboard(
            paste = {
                scope.launch {
                    val clip = clipboard.getClipEntry()?.clipData?.takeIf { it.itemCount > 0 }
                    val text = clip?.getItemAt(0)?.coerceToText(context)?.toString()
                    if (text.isNullOrEmpty()) return@launch
                    if (terminal.isPasteSafe(text)) terminal.paste(text) else unsafe.value = text
                }
            },
            copyAll = { copy(terminal::text) },
            copySelection = { copy(terminal::takeSelection) },
            unsafe = unsafe,
            terminal = terminal,
        )
    }
}
