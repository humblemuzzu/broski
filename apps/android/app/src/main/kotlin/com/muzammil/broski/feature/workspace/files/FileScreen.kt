package com.muzammil.broski.feature.workspace.files

import android.content.ClipData
import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.muzammil.broski.R
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FileRoute
import com.muzammil.broski.feature.images.ImageSaver
import com.muzammil.broski.feature.images.ZoomableImage
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.lastComponent
import kotlinx.coroutines.launch

/** One file of a Mac: text by numbered line, a zoomable image, or anything else by its size. */
@Composable
fun FileScreen(context: FeatureContext, route: FileRoute) {
    MachineGate(context.phone, route.machineId) { machine, machineState ->
        val viewModel = viewModel(key = "file:${route.machineId}:${route.path}") {
            FileViewModel(WorkspaceClient(machine::request), route.path)
        }
        val state by viewModel.state.collectAsStateWithLifecycle()
        var wrap by rememberSaveable { mutableStateOf(false) }
        val snackbar = remember { SnackbarHostState() }
        val clipboard = LocalClipboard.current
        val androidContext = LocalContext.current
        val resources = LocalResources.current
        val scope = rememberCoroutineScope()
        val shownImage = ((state as? FileUiState.Shown)?.content as? FileContent.Image)?.payload
        Scaffold(
            topBar = {
                PathTopBar(lastComponent(route.path), route.path, context.back) {
                    if ((state as? FileUiState.Shown)?.content is FileContent.Text) {
                        IconToggleButton(checked = wrap, onCheckedChange = { wrap = it }) {
                            Icon(painterResource(R.drawable.ic_wrap_text), contentDescription = stringResource(R.string.file_wrap_lines))
                        }
                    }
                    if (shownImage != null) {
                        IconButton(onClick = {
                            scope.launch {
                                val saved = ImageSaver.saveToGallery(androidContext, shownImage, lastComponent(route.path))
                                snackbar.showSnackbar(resources.getString(if (saved) R.string.image_saved else R.string.image_save_failed))
                            }
                        }) {
                            Icon(painterResource(R.drawable.ic_download), contentDescription = stringResource(R.string.image_save))
                        }
                        IconButton(onClick = {
                            scope.launch { ImageSaver.share(androidContext, shownImage, lastComponent(route.path)) }
                        }) {
                            Icon(painterResource(R.drawable.ic_share), contentDescription = stringResource(R.string.image_share))
                        }
                    }
                    IconButton(onClick = {
                        scope.launch {
                            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(route.path, route.path)))
                            snackbar.showSnackbar(resources.getString(R.string.files_path_copied))
                        }
                    }) {
                        Icon(painterResource(R.drawable.ic_content_copy), contentDescription = stringResource(R.string.files_copy_path))
                    }
                }
            },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            Column(Modifier.padding(top = padding.calculateTopPadding()).fillMaxSize()) {
                MachineBanner(machineState)
                when (val current = state) {
                    FileUiState.Loading -> WorkspaceLoading()
                    is FileUiState.Failed -> FailureMessage(current.failure, viewModel::reload, notFound = R.string.file_not_found)
                    is FileUiState.Shown -> FileBody(current.content, route.path, route.line, wrap, padding.calculateBottomPadding())
                }
            }
        }
    }
}

@Composable
private fun FileBody(content: FileContent, path: String, line: Int?, wrap: Boolean, bottom: Dp) {
    Column(Modifier.fillMaxSize()) {
        if (content.truncated) TruncatedNotice(content)
        when (content) {
            is FileContent.Text -> FileText(content.lines, path, wrap, Modifier.fillMaxSize(), PaddingValues(top = 8.dp, bottom = bottom + 24.dp), line)
            is FileContent.Image -> ImageBody(content, lastComponent(path), bottom)
            is FileContent.Bytes -> BinaryBody(content.size)
        }
    }
}

@Composable
private fun ImageBody(content: FileContent.Image, name: String, bottom: Dp) {
    val context = LocalContext.current
    val payload = content.payload
    Box(Modifier.fillMaxSize()) {
        ZoomableImage(
            bitmap = payload.bitmap,
            animated = payload.animated,
            hasAlpha = payload.hasAlpha,
            contentDescription = name,
            modifier = Modifier.fillMaxSize(),
        )
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.92f),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = bottom + 16.dp),
        ) {
            Text(
                "${payload.pixelWidth} × ${payload.pixelHeight} · ${Formatter.formatShortFileSize(context, content.size)}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            )
        }
    }
}

@Composable
private fun TruncatedNotice(content: FileContent) {
    val context = LocalContext.current
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Text(
            stringResource(
                R.string.file_truncated,
                Formatter.formatShortFileSize(context, content.shown),
                Formatter.formatShortFileSize(context, content.size),
            ),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(12.dp),
        )
    }
}

@Composable
private fun BinaryBody(bytes: Long) {
    val size = Formatter.formatShortFileSize(LocalContext.current, bytes)
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Icon(painterResource(R.drawable.ic_draft), contentDescription = null, modifier = Modifier.size(48.dp))
        Text(stringResource(R.string.file_binary, size), style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
    }
}
