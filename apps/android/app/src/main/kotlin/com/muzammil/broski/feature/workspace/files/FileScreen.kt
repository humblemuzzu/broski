package com.muzammil.broski.feature.workspace.files

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FileRoute
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.lastComponent
import kotlinx.coroutines.delay

/** One file of a Mac: text by numbered line, a zoomable image, or what it is; copy its path, copy or share what it holds. */
@Composable
fun FileScreen(context: FeatureContext, route: FileRoute) {
    MachineGate(context.phone, route.machineId) { machine, machineState ->
        val viewModel = viewModel(key = "file:${route.machineId}:${route.path}") {
            FileViewModel(WorkspaceClient(machine::request), route.path)
        }
        val state by viewModel.state.collectAsStateWithLifecycle()
        var wrap by rememberSaveable { mutableStateOf(true) }
        val toast = rememberToast()
        val shown = (state as? FileUiState.Shown)?.content
        Scaffold(
            topBar = {
                PathTopBar(lastComponent(route.path), route.path, context.back) {
                    FileMenu(route.path, shown, wrap, { wrap = it }, toast::say)
                }
            },
        ) { padding ->
            Box(Modifier.fillMaxSize()) {
                Column(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
                    MachineBanner(machineState)
                    when (val current = state) {
                        FileUiState.Loading -> WorkspaceLoading()
                        is FileUiState.Failed -> FailureMessage(current.failure, viewModel::reload, notFound = R.string.file_not_found)
                        is FileUiState.Shown -> FileBody(current.content, route.path, route.line, wrap, padding.calculateBottomPadding())
                    }
                }
                FileToast(toast.message, Modifier.padding(top = padding.calculateTopPadding()))
            }
        }
    }
}

/** The one message of the last copy or save, gone after a moment, each with iOS's success haptic. */
class ToastState(private val haptic: () -> Unit) {
    var message by mutableStateOf<String?>(null)
        private set

    fun say(text: String) {
        haptic()
        message = text
    }

    fun clear(text: String) {
        if (message == text) message = null
    }
}

@Composable
private fun rememberToast(): ToastState {
    val haptics = LocalHapticFeedback.current
    val toast = remember { ToastState { haptics.perform(Haptic.Success) } }
    val message = toast.message
    LaunchedEffect(message) {
        if (message != null) {
            delay(TOAST_MS)
            toast.clear(message)
        }
    }
    return toast
}

@Composable
private fun FileMenu(path: String, content: FileContent?, wrap: Boolean, onWrap: (Boolean) -> Unit, say: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val actions = rememberFileActions(lastComponent(path), say) { open = false }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(painterResource(R.drawable.ic_more_horiz), contentDescription = stringResource(R.string.files_more))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            MenuItem(R.string.files_copy_path, R.drawable.ic_content_copy) { actions.copyPath(path) }
            when (content) {
                is FileContent.Text -> {
                    val text = content.lines.joinToString("\n")
                    MenuItem(R.string.file_copy_text, R.drawable.ic_description) { actions.copyText(text) }
                    MenuItem(R.string.file_share, R.drawable.ic_share) { actions.shareText(text) }
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.file_wrap_lines)) },
                        leadingIcon = { Icon(painterResource(R.drawable.ic_wrap_text), contentDescription = null) },
                        trailingIcon = { Checkbox(checked = wrap, onCheckedChange = null) },
                        onClick = { onWrap(!wrap) },
                    )
                }
                is FileContent.Image -> {
                    MenuItem(R.string.file_save, R.drawable.ic_download) { actions.save(content.payload) }
                    MenuItem(R.string.file_copy_image, R.drawable.ic_photo_library) { actions.copyImage(content.payload) }
                    MenuItem(R.string.file_share, R.drawable.ic_share) { actions.shareImage(content.payload) }
                }
                else -> Unit
            }
        }
    }
}

@Composable
private fun FileBody(content: FileContent, path: String, line: Int?, wrap: Boolean, bottom: Dp) {
    Column(Modifier.fillMaxSize()) {
        if (content.truncated) TruncatedNote(content)
        val fill = Modifier.weight(1f).fillMaxSize()
        when (content) {
            is FileContent.Text -> FileText(content.lines, path, wrap, fill, PaddingValues(vertical = 8.dp).plus(bottom), line)
            is FileContent.Image -> ImageBody(content, bottom, fill)
            is FileContent.Bytes -> BinaryBody(content.size, fill)
        }
    }
}

private fun PaddingValues.plus(bottom: Dp) = PaddingValues(top = calculateTopPadding(), bottom = calculateBottomPadding() + bottom)

private const val TOAST_MS = 1_800L
