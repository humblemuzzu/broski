package com.muzammil.broski.feature.chat.composer

import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
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
import com.muzammil.broski.R
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
 * six, then scrolling), and under it `+`, the setting chips and the one button. It rides the
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
) {
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
            BasicTextField(
                state = state.input,
                lineLimits = TextFieldLineLimits.MultiLine(minHeightInLines = 1, maxHeightInLines = 6),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp).then(focus?.let { Modifier.focusRequester(it) } ?: Modifier),
                decorator = { field ->
                    Box {
                        if (state.input.text.isEmpty()) {
                            Text(look.placeholder, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        field()
                    }
                },
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (look.images) AttachMenu(actions.onImage, actions.onNoImage)
                val scroll = rememberScrollState()
                Row(
                    Modifier.weight(1f).trailingFade(scroll).horizontalScroll(scroll),
                    verticalAlignment = Alignment.CenterVertically,
                ) { ModelChips(look.settings, actions.settings) }
                PrimaryModeChip(look.settings, actions.settings)
                SendButtonView(look.button, actions.onPress)
            }
        }
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
    Row(
        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        images.forEach { image ->
            Box {
                Image(
                    image.thumbnail,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)),
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
