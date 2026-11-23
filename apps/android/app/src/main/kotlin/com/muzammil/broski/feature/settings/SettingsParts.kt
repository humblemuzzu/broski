package com.muzammil.broski.feature.settings

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.design.GlassCircleButton
import com.muzammil.broski.design.GlassMetrics
import com.muzammil.broski.R
import com.muzammil.broski.design.Grouped
import com.muzammil.broski.design.LocalTabBarClearance
import com.muzammil.broski.design.SoftTopBar
import com.muzammil.broski.design.IosText
import com.muzammil.broski.feature.usage.ScreenTitleBar
import com.muzammil.broski.feature.usage.titleBarInset

/** The tiles' colours as iOS's system colours: red, blue, orange and grey, a step lighter on black. */
object TileTint {
    val Notifications: Color @Composable get() = if (isDark()) Color(0xFFFF453A) else Color(0xFFFF3B30)
    val Appearance: Color @Composable get() = if (isDark()) Color(0xFF0A84FF) else Color(0xFF007AFF)
    val Voice: Color @Composable get() = if (isDark()) Color(0xFFFF9F0A) else Color(0xFFFF9500)
    val Neutral: Color @Composable get() = Color(0xFF8E8E93)
}

@Composable
private fun isDark() = MaterialTheme.colorScheme.surface.luminance() < 0.5f

/**
 * A settings screen on the grouped grey: Settings itself is a small bold title over its rows; the
 * screens under it a round glass back button and their name centred, as iOS pushes them. Both bars
 * sit over the rows on a soft fade.
 */
@Composable
fun SettingsPage(
    title: String,
    onBack: (() -> Unit)?,
    action: (@Composable () -> Unit)? = null,
    overlay: (@Composable () -> Unit)? = null,
    content: LazyListScope.() -> Unit,
) {
    Box(Modifier.fillMaxSize().background(Grouped.screen)) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = titleBarInset() + 8.dp + if (onBack == null) 0.dp else 12.dp,
                bottom = 32.dp + LocalTabBarClearance.current,
            ),
            content = content,
        )
        overlay?.invoke()
        SoftTopBar(Grouped.screen) {
            if (onBack == null) ScreenTitleBar(title) else PushedBar(title, onBack, action)
        }
    }
}

@Composable
private fun PushedBar(title: String, onBack: () -> Unit, action: (@Composable () -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GlassCircleButton(R.drawable.ic_chevron_left, stringResource(R.string.action_back), onBack)
        Text(
            title,
            fontSize = 17.sp,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = 1,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (action != null) action() else Spacer(Modifier.size(GlassMetrics.control))
    }
}

/** A white symbol on a rounded-square tile of its colour, as the system's Settings draws its rows. */
@Composable
fun SettingsTile(@DrawableRes icon: Int, tint: Color) {
    Box(Modifier.size(30.dp).background(tint, RoundedCornerShape(7.8.dp)), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), contentDescription = null, tint = Color.White, modifier = Modifier.size(15.dp))
    }
}

/** A row of a group that opens a screen: its tile, its title, its current value and a chevron. */
@Composable
fun SettingsLink(
    index: Int,
    count: Int,
    title: String,
    @DrawableRes icon: Int,
    tint: Color,
    onClick: () -> Unit,
    value: String? = null,
    card: Color = Grouped.card,
) {
    GroupedCardRow(index, count, onClick, card) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(horizontal = 16.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SettingsTile(icon, tint)
            Text(title, style = IosText.body, modifier = Modifier.weight(1f))
            value?.let { Text(it, style = IosText.body, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1) }
            Icon(
                painterResource(R.drawable.ic_chevron_right),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
            )
        }
    }
}

/** Row [index] of [count] of an inset group: the card's fill and corners, a hairline above every row but the first. */
@Composable
fun GroupedCardRow(
    index: Int,
    count: Int,
    onClick: (() -> Unit)?,
    card: Color = Grouped.card,
    separatorInset: Dp = SEPARATOR_INSET,
    content: @Composable () -> Unit,
) {
    Box(
        Modifier
            .padding(horizontal = Grouped.margin)
            .clip(Grouped.shape(index, count))
            .background(card)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier),
    ) {
        content()
        if (index > 0) {
            HorizontalDivider(
                modifier = Modifier.align(Alignment.TopStart).padding(start = separatorInset, end = 20.dp),
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
            )
        }
    }
}

/** Where a row's hairline starts: under its title, past the tile. */
private val SEPARATOR_INSET = 16.dp + 30.dp + 12.dp

/** The quiet words under a group. */
@Composable
fun SettingsFooter(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 32.dp, vertical = 6.dp),
    )
}
