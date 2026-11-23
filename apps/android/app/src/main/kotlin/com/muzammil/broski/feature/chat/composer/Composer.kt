package com.muzammil.broski.feature.chat.composer

import android.net.Uri
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.content.MediaType
import androidx.compose.foundation.content.consume
import androidx.compose.foundation.content.contentReceiver
import androidx.compose.foundation.content.hasMediaType
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.core.voice.DictationPhase
import com.muzammil.broski.design.animationsEnabled
import com.muzammil.broski.design.beam.borderBeam
import com.muzammil.broski.design.voiceglow.voiceGlow
import com.muzammil.broski.feature.chat.composer.dictation.DictationHaptics
import com.muzammil.broski.feature.chat.composer.dictation.DictationHook
import com.muzammil.broski.feature.chat.composer.dictation.DictationMic
import com.muzammil.broski.feature.chat.composer.dictation.DictationNoticeText
import com.muzammil.broski.feature.chat.composer.dictation.RecordingBar
import uniffi.broski_contract.CommandSummary

/**
 * What the composer shows besides its own state: what the field says, what its button does, and whether
 * a run is live (the beam rides the rim then).
 */
@Immutable
class ComposerLook(
    val placeholder: String,
    val button: SendButton,
    val images: Boolean,
    val settings: ComposerSettings,
    val running: Boolean = false,
)

@Immutable
class ComposerActions(
    val onPress: (SendFace) -> Unit,
    val onImage: (Uri) -> Unit,
    val onNoImage: () -> Unit,
    val settings: SettingActions,
)

/**
 * The composer, one floating surface in two shapes. At rest, while the person is not writing: a
 * capsule of `+`, the field ("Type or hold to talk"), the mic, and Stop while a run is live. Open, once
 * the field has focus or holds something: the field across the top, growing to six lines, and under it
 * `+`, the model pill, the mic and the send button, which comes in with the first character. Above the
 * field the waiting images and the picked command. While dictating the recording takes the field's line
 * and ✕ the place of `+`. It rides the keyboard through the screen's insets; while a run is live a beam
 * rides its rim, and while recording a glow rises from its bottom edge with the voice.
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
    val failed = phase is DictationPhase.Failed
    val listening = (phase as? DictationPhase.Recording)?.cancelling == false
    dictation?.let { DictationHaptics(it) }
    val requester = focus ?: remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    var pickingModel by rememberSaveable { mutableStateOf(false) }
    var refocusAfterSheet by remember { mutableStateOf(false) }
    val hasInput = state.input.text.isNotBlank() || images.isNotEmpty() || command != null
    val open = focused || hasInput || failed
    val progress by animateFloatAsState(
        if (open) 1f else 0f,
        if (animationsEnabled()) spring(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow) else spring(stiffness = Spring.StiffnessHigh),
        label = "composer",
    )
    val placeholder = if (!open && dictation != null && !look.running) stringResource(R.string.composer_placeholder_resting) else look.placeholder
    val showsSend = dictation == null || look.button.face != SendFace.Send || hasInput
    val radius = ComposerMetrics.RADIUS
    Surface(
        modifier = modifier.fillMaxWidth()
            .borderBeam(active = look.running && animationsEnabled(), cornerRadius = radius)
            .then(
                dictation?.let { hook -> Modifier.voiceGlow(level = { hook.dictation.level }, active = listening, cornerRadius = radius) }
                    ?: Modifier,
            ),
        shape = RoundedCornerShape(radius),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 2.dp,
        shadowElevation = 2.dp,
    ) {
        Column(
            Modifier
                .pointerInput(requester) { detectTapGestures { requester.requestFocus() } }
                .padding(ComposerMetrics.INSET),
        ) {
            if (images.isNotEmpty()) ImageStrip(images, state::remove)
            command?.let { CommandChip(it, state::clearCommand) }
            dictation?.let { hook -> dictationState?.noticeFor(hook.target.id) }?.let { notice ->
                DictationNoticeText(notice, Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
            }
            ComposerLayout(
                progress = progress,
                leading = {
                    when {
                        dictating && !failed -> CancelDictation { dictation?.dictation?.cancel() }
                        look.images -> AttachMenu(actions.onImage, actions.onNoImage)
                    }
                },
                field = {
                    if (dictation != null && dictationState != null && dictating) {
                        RecordingBar(dictationState, phase, dictation.dictation, dictation.openVoiceSettings)
                    } else {
                        Field(state, placeholder, look, actions, requester) { focused = it }
                    }
                },
                pickers = {
                    if (progress > 0f && !dictating) {
                        Box(Modifier.graphicsLayer { alpha = progress }) {
                            ComposerPickers(look.settings, actions.settings) {
                                refocusAfterSheet = focused
                                pickingModel = true
                            }
                        }
                    }
                },
                trailing = {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (dictation != null && dictationState != null) {
                            DictationMic(dictation, phase, busy = dictationState.busyApartFrom(dictation.target.id))
                        }
                        if (showsSend) {
                            SendButtonView(if (dictating && look.button.face != SendFace.Stop) look.button.copy(enabled = false) else look.button, actions.onPress)
                        }
                    }
                },
            )
        }
    }
    if (pickingModel) {
        ModelSheet(look.settings, actions.settings) {
            pickingModel = false
            if (refocusAfterSheet) {
                refocusAfterSheet = false
                requester.requestFocus()
            }
        }
    }
}

@Composable
private fun Field(
    state: ComposerState,
    placeholder: String,
    look: ComposerLook,
    actions: ComposerActions,
    requester: FocusRequester,
    onFocus: (Boolean) -> Unit,
) {
    BasicTextField(
        state = state.input,
        lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = 6),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        modifier = Modifier.fillMaxWidth()
            .focusRequester(requester)
            .onFocusChanged { onFocus(it.isFocused) }
            .onPreviewKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown &&
                    event.key == Key.Enter &&
                    (event.isCtrlPressed || event.isMetaPressed) &&
                    look.button.enabled
                ) {
                    actions.onPress(look.button.face)
                    true
                } else {
                    false
                }
            }
            .then(if (look.images) Modifier.pastedImages(actions.onImage) else Modifier),
        decorator = { field ->
            Box {
                if (state.input.text.isEmpty()) {
                    Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
                field()
            }
        },
    )
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
