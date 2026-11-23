package com.muzammil.broski.feature.chat.header

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.chatCanvas
import com.muzammil.broski.design.GlassCircleButton
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.design.SoftTopBar
import com.muzammil.broski.design.label
import com.muzammil.broski.feature.chat.ChatHeader

/**
 * The chat's header as iOS draws it over the transcript: a round glass back button, the title on a
 * glass capsule in the middle (tap to rename) with the folder under it, or the Mac's state in words
 * while it is not ready, and a round glass More button whose menu opens with how full the context is.
 * The transcript slides softly under it; what runs and for how long is the status lane's to say.
 */
@Composable
fun ChatTopBar(
    header: ChatHeader,
    contextPercent: Int?,
    onBack: () -> Unit,
    onRename: (() -> Unit)?,
    menu: @Composable (dismiss: () -> Unit) -> Unit,
    onMenu: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    SoftTopBar(chatCanvas, modifier) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            GlassCircleButton(R.drawable.ic_chevron_left, stringResource(R.string.action_back), onBack)
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { TitlePill(header, onRename) }
            Box {
                GlassCircleButton(R.drawable.ic_more_horiz, stringResource(R.string.chat_more), { onMenu(true) })
                menu { onMenu(false) }
            }
        }
    }
}

@Composable
private fun TitlePill(header: ChatHeader, onRename: (() -> Unit)?) {
    val health = header.health
    val problem = when {
        health != null && !health.isOnline -> health.label(header.machineName)
        header.reconnecting -> stringResource(R.string.chat_reconnecting)
        else -> null
    }
    val line = problem ?: header.folder
    val hint = stringResource(R.string.chat_rename_hint)
    GlassSurface(
        shape = CircleShape,
        modifier = Modifier
            .widthIn(max = 240.dp)
            .heightIn(min = 44.dp)
            .clip(CircleShape)
            .then(if (onRename != null) Modifier.clickable(role = Role.Button, onClickLabel = hint, onClick = onRename) else Modifier),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                header.title ?: stringResource(R.string.inbox_untitled),
                fontSize = 15.sp,
                lineHeight = 19.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
            line?.let {
                Text(
                    it,
                    fontSize = 12.sp,
                    lineHeight = 15.sp,
                    color = if (problem != null) BroskiTheme.semantic.caution else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/** How much of the context window the conversation fills, when the Mac reports both, as a whole percent. */
fun contextPercent(tokens: Long?, window: Long?): Int? {
    if (tokens == null || window == null || window <= 0) return null
    return Math.round(tokens.toDouble() / window * 100).toInt()
}
