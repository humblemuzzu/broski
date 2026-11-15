package com.muzammil.broski.feature.workspace.files

import android.content.ClipData
import android.graphics.BitmapFactory
import android.text.format.Formatter
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
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
import com.muzammil.broski.feature.workspace.FailureMessage
import com.muzammil.broski.feature.workspace.MachineBanner
import com.muzammil.broski.feature.workspace.MachineGate
import com.muzammil.broski.feature.workspace.PathTopBar
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceLoading
import com.muzammil.broski.feature.workspace.lastComponent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One file of a Mac: text by numbered line, an image as itself, anything else by its size. */
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
        val resources = LocalResources.current
        val scope = rememberCoroutineScope()
        Scaffold(
            topBar = {
                PathTopBar(lastComponent(route.path), route.path, context.back) {
                    if ((state as? FileUiState.Shown)?.content is FileContent.Text) {
                        IconToggleButton(checked = wrap, onCheckedChange = { wrap = it }) {
                            Icon(painterResource(R.drawable.ic_wrap_text), contentDescription = stringResource(R.string.file_wrap_lines))
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
                    is FileUiState.Shown -> FileBody(current.content, route.path, wrap, padding.calculateBottomPadding())
                }
            }
        }
    }
}

@Composable
private fun FileBody(content: FileContent, path: String, wrap: Boolean, bottom: Dp) {
    Column(Modifier.fillMaxSize()) {
        if (content.truncated) TruncatedNotice(content)
        when (content) {
            is FileContent.Text -> FileText(content.lines, path, wrap, Modifier.fillMaxSize(), PaddingValues(top = 8.dp, bottom = bottom + 24.dp))
            is FileContent.Bytes -> BytesBody(content, lastComponent(path))
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
private fun BytesBody(content: FileContent.Bytes, name: String) {
    val decoded by produceState<Decoded>(Decoded.Pending, content) {
        value = withContext(Dispatchers.Default) {
            val bitmap = if (content.truncated) null else BitmapFactory.decodeByteArray(content.bytes, 0, content.bytes.size)
            bitmap?.let { Decoded.Image(it.asImageBitmap()) } ?: Decoded.NotAnImage
        }
    }
    when (val current = decoded) {
        Decoded.Pending -> WorkspaceLoading()
        is Decoded.Image -> Image(
            bitmap = current.bitmap,
            contentDescription = name,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize().padding(16.dp),
        )
        Decoded.NotAnImage -> BinaryBody(content.size)
    }
}

private sealed interface Decoded {
    data object Pending : Decoded

    class Image(val bitmap: ImageBitmap) : Decoded

    data object NotAnImage : Decoded
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
