package com.muzammil.broski.feature.chat.composer

import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.core.voice.DictationPhase
import com.muzammil.broski.feature.chat.composer.dictation.DictationHaptics
import com.muzammil.broski.feature.chat.composer.dictation.DictationHook
import com.muzammil.broski.feature.chat.composer.dictation.DictationMic
import com.muzammil.broski.feature.chat.composer.dictation.DictationNoticeText
import com.muzammil.broski.feature.chat.composer.dictation.RecordingBar
import com.muzammil.broski.feature.images.ChatImageStore
import com.muzammil.broski.feature.images.FullImageResult
import com.muzammil.broski.feature.images.ImageLightbox
import com.muzammil.broski.feature.images.ImageTarget
import com.muzammil.broski.feature.images.LightboxRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.broski_contract.CommandSummary

/** What the composer shows besides its own state: who it talks to and what its button does. */
@Immutable
class ComposerLook(
    val placeholder: String,
    val button: SendButton,
    val images: Boolean,
    val settings: ComposerSettings,
)

@Immutable
class ComposerActions(
    val onPress: (SendFace) -> Unit,
    val onImage: (Uri) -> Unit,
    val onNoImage: () -> Unit,
    val settings: SettingActions,
)

/**
 * One floating surface: the waiting images, the picked command, the field (one line, growing to
 * six, then scrolling), and under it `+`, the setting chips, the mic and the one button. While
 * dictating, the recording takes the field's place and ✕ the place of `+` and the chips. It rides the
 * keyboard through the screen's insets; its height follows its text with no animation of its own.
 */
@Composable
fun Composer(
    state: ComposerState,
    command: CommandSummary?,
    images: List<ComposerImage>,
    look: ComposerLook,
    actions: ComposerActions,
    modifier: Modifier = Modifier,
    focus: FocusRequester? = null,
    dictation: DictationHook? = null,
) {
    val dictationState = dictation?.let { it.dictation.state.collectAsStateWithLifecycle().value }
    val phase = dictation?.let { dictationState?.phaseFor(it.target.id) } ?: DictationPhase.Idle
    val dictating = phase != DictationPhase.Idle
    dictation?.let { DictationHaptics(it) }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 2.dp,
        shadowElevation = 2.dp,
    ) {
        Column(Modifier.padding(top = 8.dp, bottom = 6.dp)) {
            if (images.isNotEmpty()) ImageStrip(images, state::remove)
            command?.let { CommandChip(it, state::clearCommand) }
            if (dictation != null && dictationState != null && dictating) {
                RecordingBar(
                    dictationState, phase, dictation.dictation, dictation.openVoiceSettings,
                    Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
            } else BasicTextField(
                state = state.input,
                lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = 6),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier.fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp)
                    .then(focus?.let { Modifier.focusRequester(it) } ?: Modifier)
                    .then(if (look.images) Modifier.pastedImages(actions.onImage) else Modifier),
                decorator = { field ->
                    Box {
                        if (state.input.text.isEmpty()) {
                            Text(look.placeholder, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        field()
                    }
                },
            )
            dictation?.let { hook -> dictationState?.noticeFor(hook.target.id) }?.let { notice ->
                DictationNoticeText(notice, Modifier.padding(horizontal = 20.dp, vertical = 2.dp))
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (dictating) {
                    if (phase !is DictationPhase.Failed) CancelDictation { dictation?.dictation?.cancel() }
                    Spacer(Modifier.weight(1f))
                } else {
                    if (look.images) AttachMenu(actions.onImage, actions.onNoImage)
                    val scroll = rememberScrollState()
                    Row(
                        Modifier.weight(1f).trailingFade(scroll).horizontalScroll(scroll),
                        verticalAlignment = Alignment.CenterVertically,
                    ) { ModelChips(look.settings, actions.settings) }
                    PrimaryModeChip(look.settings, actions.settings)
                }
                if (dictation != null && dictationState != null) {
                    DictationMic(dictation, phase, busy = dictationState.busyApartFrom(dictation.target.id))
                }
                if (!dictating) SendButtonView(look.button, actions.onPress)
            }
        }
    }
}

/** An image pasted into the field, or sent from the keyboard, joins the waiting images; text is left to the field. */
@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.pastedImages(onImage: (Uri) -> Unit): Modifier = contentReceiver { content ->
    if (!content.hasMediaType(MediaType.Image)) {
        content
    } else {
        content.consume { item -> item.uri?.let(onImage) != null }
    }
}

/** The end of a row that goes on under the edge fades out, so the cut reads as scrolling and not as the end. */
private fun Modifier.trailingFade(scroll: ScrollState): Modifier = graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)
    .drawWithContent {
        drawContent()
        if (scroll.value < scroll.maxValue) {
            val fade = FADE.toPx()
            drawRect(
                Brush.horizontalGradient(listOf(Color.Black, Color.Transparent), size.width - fade, size.width),
                topLeft = Offset(size.width - fade, 0f),
                size = size.copy(width = fade),
                blendMode = BlendMode.DstIn,
            )
        }
    }

private val FADE = 28.dp

/** ✕ in place of `+` while dictating: throws the recording away. */
@Composable
private fun CancelDictation(onCancel: () -> Unit) {
    IconButton(onClick = onCancel) {
        Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.dictation_cancel), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CommandChip(command: CommandSummary, onClear: () -> Unit) {
    InputChip(
        selected = true,
        onClick = onClear,
        label = { Text("/${command.name}") },
        trailingIcon = { Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.composer_remove_command), Modifier.size(18.dp)) },
        modifier = Modifier.padding(horizontal = 16.dp),
    )
}

@Composable
private fun ImageStrip(images: List<ComposerImage>, onRemove: (String) -> Unit) {
    var preview by remember { mutableStateOf<LightboxRequest?>(null) }
    preview?.let { request ->
        ImageLightbox(request) { preview = null }
    }
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        images.forEachIndexed { index, image ->
            Box {
                Image(
                    image.thumbnail,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(64.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable {
                            val snapshot = images.toList()
                            val byId = snapshot.associateBy { it.id }
                            preview = LightboxRequest(
                                items = snapshot.map { ImageTarget.Local(it.id, name = null) },
                                initialIndex = index,
                                thumbnail = { target -> (target as? ImageTarget.Local)?.let { byId[it.id]?.thumbnail } },
                                loadFull = { target ->
                                    val item = (target as? ImageTarget.Local)?.let { byId[it.id] }
                                        ?: return@LightboxRequest FullImageResult.Failed("Image removed.")
                                    val payload = withContext(Dispatchers.Default) {
                                        ChatImageStore.decodePayload(item.base64, item.mimeType, null, null, null)
                                    }
                                    if (payload != null) FullImageResult.Loaded(payload) else FullImageResult.Failed("Couldn't decode image.")
                                },
                                onRemove = { target ->
                                    (target as? ImageTarget.Local)?.let { onRemove(it.id) }
                                },
                            )
                        },
                )
                Surface(
                    onClick = { onRemove(image.id) },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.inverseSurface,
                    contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                    modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(22.dp),
                ) {
                    Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.composer_remove_image), Modifier.padding(3.dp))
                }
            }
        }
    }
}
