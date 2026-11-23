package com.muzammil.broski.feature.chat.composer

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R

/**
 * The composer's one button that acts, its face from [SendButton]: an ink circle while it can send or
 * stop, a soft one while it cannot. When the backend takes both queue and steer, a long press offers
 * the other with what it does.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SendButtonView(button: SendButton, onPress: (SendFace) -> Unit) {
    val colors = MaterialTheme.colorScheme
    val (container, content) = if (button.enabled) colors.primary to colors.onPrimary else composerFill to colors.onSurface.copy(alpha = 0.38f)
    val fill by animateColorAsState(container, MaterialTheme.motionScheme.fastEffectsSpec(), label = "fill")
    var offering by remember { mutableStateOf(false) }
    val label = stringResource(button.face.label)
    Box(
        Modifier
            .size(ComposerMetrics.CONTROL)
            .clip(CircleShape)
            .background(fill)
            .combinedClickable(
                interactionSource = null,
                indication = ripple(),
                enabled = button.enabled,
                role = Role.Button,
                onClickLabel = label,
                onLongClickLabel = button.alternative?.let { stringResource(it.label) },
                onLongClick = button.alternative?.let { { offering = true } },
                onClick = { onPress(button.face) },
            ),
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(button.face, transitionSpec = { scaleIn() togetherWith scaleOut() }, label = "face") { face ->
            Icon(painterResource(face.icon), contentDescription = label, tint = content, modifier = Modifier.size(16.dp))
        }
        DropdownMenu(expanded = offering, onDismissRequest = { offering = false }) {
            listOfNotNull(button.face, button.alternative).forEach { face ->
                DropdownMenuItem(
                    text = { OptionText(stringResource(face.label), face.explanation?.let { stringResource(it) }) },
                    leadingIcon = { Icon(painterResource(face.icon), contentDescription = null) },
                    onClick = {
                        offering = false
                        onPress(face)
                    },
                )
            }
        }
    }
}

private val SendFace.icon: Int
    get() = when (this) {
        SendFace.Send, SendFace.Queue -> R.drawable.ic_arrow_upward
        SendFace.Steer -> R.drawable.ic_alt_route
        SendFace.Stop -> R.drawable.ic_stop_fill1
    }

val SendFace.label: Int
    get() = when (this) {
        SendFace.Send -> R.string.composer_send
        SendFace.Queue -> R.string.composer_queue
        SendFace.Steer -> R.string.composer_steer
        SendFace.Stop -> R.string.composer_stop
    }

private val SendFace.explanation: Int?
    get() = when (this) {
        SendFace.Queue -> R.string.composer_queue_explained
        SendFace.Steer -> R.string.composer_steer_explained
        SendFace.Send, SendFace.Stop -> null
    }
