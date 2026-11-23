package com.muzammil.broski.feature.chat.interactions

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Glass
import com.muzammil.broski.design.GlassButton
import com.muzammil.broski.design.IosText
import com.muzammil.broski.design.format.FormatRole
import com.muzammil.broski.design.format.FormattedMessage
import kotlin.math.abs

/** How tall an ask's own content may grow before it scrolls: less while the keyboard is up, so its answers never leave the screen. */
val LocalAskCap = compositionLocalOf { 320.dp }

/** The agent's words above any ask (its body), drawn first inside the scrolling part. */
val LocalAskIntro = compositionLocalOf<String?> { null }

/**
 * What every ask shares under its header: the ask itself scrolling inside a cap, and its answers
 * pinned beneath it where the thumb is, so no length of ask pushes them away. Dragging the ask puts
 * the keyboard away.
 */
@Composable
fun AskBody(content: @Composable ColumnScope.() -> Unit, actions: @Composable ColumnScope.() -> Unit) {
    val keyboard = LocalSoftwareKeyboardController.current
    val putsKeyboardAway = remember(keyboard) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput && abs(available.y) > 2f) keyboard?.hide()
                return Offset.Zero
            }
        }
    }
    val intro = LocalAskIntro.current
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = LocalAskCap.current)
                .nestedScroll(putsKeyboardAway)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            intro?.let { FormattedMessage(it, role = FormatRole.Quiet) }
            content()
        }
        actions()
    }
}

/** A text field's quiet fill inside a card, 44 dp at least, named for TalkBack by its [hint]. */
fun Modifier.askField(hint: String): Modifier = composed {
    fillMaxWidth()
        .heightIn(min = 44.dp)
        .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f), RoundedCornerShape(22.dp))
        .padding(horizontal = 16.dp, vertical = 11.dp)
        .semantics { contentDescription = hint }
}

/** A field's [hint] in grey while it is [empty], under the [field] itself. */
@Composable
fun FieldHint(empty: Boolean, hint: String, field: @Composable () -> Unit) {
    Box {
        if (empty) Text(hint, style = IosText.body, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        field()
    }
}

/** A card's quieter words, the agent's or ours, through the formatter. */
@Composable
fun Quiet(text: String) {
    FormattedMessage(text, role = FormatRole.Quiet)
}

enum class AskLook { Primary, Secondary, Destructive }

/** One answer as a full-width button of the row it shares: the main one in ink, a refusal on glass in red, any other on glass. */
@Composable
fun RowScope.AskButton(title: String, look: AskLook, enabled: Boolean = true, onClick: () -> Unit) {
    GlassButton(
        title,
        onClick,
        modifier = Modifier.weight(1f),
        prominent = look == AskLook.Primary,
        tint = if (look == AskLook.Destructive) MaterialTheme.colorScheme.error else null,
        enabled = enabled,
        height = 50.dp,
    )
}

/** A row of [AskButton]s, 8 dp apart. */
@Composable
fun AskButtons(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), content = content)
}

/** One quieter answer under the main ones. */
class AskLink(val label: String, val description: String = label, val enabled: Boolean = true, val onClick: () -> Unit)

/** The quieter answers under the main ones, centred, wrapping when they do not fit. */
@Composable
fun AskLinks(links: List<AskLink>) {
    FlowRow(
        Modifier.fillMaxWidth().padding(top = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        links.forEach { link ->
            Text(
                link.label,
                style = IosText.subheadline.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (link.enabled) 1f else 0.4f),
                modifier = Modifier
                    .clickable(enabled = link.enabled, role = Role.Button, onClickLabel = link.description, onClick = link.onClick)
                    .semantics { contentDescription = link.description }
                    .padding(vertical = 6.dp),
            )
        }
    }
}

/** Words for the agent in place of the answer buttons: a way back, the field, focused, and the send arrow that sends them. */
@Composable
fun AskReplyBar(
    field: TextFieldState,
    placeholder: String,
    sendLabel: String,
    cancelLabel: String,
    canSend: Boolean,
    onCancel: () -> Unit,
    onSend: () -> Unit,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val ready = canSend && field.text.isNotBlank()
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        RoundButton(R.drawable.ic_close, cancelLabel, Glass.fill, MaterialTheme.colorScheme.onSurfaceVariant, true, onCancel)
        BasicTextField(
            state = field,
            lineLimits = TextFieldLineLimits.MultiLine(1, 4),
            textStyle = IosText.body.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 44.dp)
                .focusRequester(focus)
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f), RoundedCornerShape(22.dp))
                .padding(horizontal = 16.dp, vertical = 11.dp)
                .semantics { contentDescription = placeholder },
            decorator = { inner ->
                Box {
                    if (field.text.isEmpty()) Text(placeholder, style = IosText.body, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                    inner()
                }
            },
        )
        RoundButton(
            R.drawable.ic_arrow_upward,
            sendLabel,
            if (ready) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
            if (ready) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
            ready,
            onSend,
        )
    }
}

@Composable
private fun RoundButton(icon: Int, label: String, fill: Color, tint: Color, enabled: Boolean, onClick: () -> Unit, side: Dp = 44.dp) {
    Box(
        Modifier
            .size(side)
            .background(fill, CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), contentDescription = null, tint = tint, modifier = Modifier.size(20.dp))
    }
}
