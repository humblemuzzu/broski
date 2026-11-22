package com.muzammil.broski.feature.chat.header

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.Orb
import com.muzammil.broski.design.label
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.feature.chat.ChatHeader
import com.muzammil.broski.feature.chat.work.duration
import kotlinx.coroutines.delay

/**
 * The chat's header: back, the title (renamed on a tap) over `agent · folder · machine`, with the
 * run's elapsed time behind a working orb while one is live, or the machine's state in words when it is not ready;
 * then Files and the overflow, the context ring drawn around the overflow. The bar takes its
 * container only while the transcript runs under it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatTopBar(
    header: ChatHeader,
    runStartedAt: Long?,
    contextUsed: Float?,
    scrolledUnder: Boolean,
    onBack: () -> Unit,
    onRename: (() -> Unit)?,
    onOpenFiles: (() -> Unit)?,
    menu: @Composable (dismiss: () -> Unit) -> Unit,
    menuOpen: Boolean,
    onMenu: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val container by animateColorAsState(
        if (scrolledUnder) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surface.copy(alpha = 0f),
        MaterialTheme.motionScheme.defaultEffectsSpec(),
        label = "scrim",
    )
    TopAppBar(
        title = {
            Text(
                header.title ?: stringResource(R.string.inbox_untitled),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = if (onRename != null) Modifier.clickable(onClickLabel = stringResource(R.string.chat_rename), role = Role.Button, onClick = onRename) else Modifier,
            )
        },
        subtitle = { Subtitle(header, runStartedAt) },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
            }
        },
        actions = {
            if (onOpenFiles != null) {
                IconButton(onClick = onOpenFiles) {
                    Icon(painterResource(R.drawable.ic_folder_open), contentDescription = stringResource(R.string.chat_open_files))
                }
            }
            OverflowWithRing(contextUsed, menuOpen, onMenu, menu)
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = container, scrolledContainerColor = container),
        modifier = modifier,
    )
}

@Composable
private fun Subtitle(header: ChatHeader, runStartedAt: Long?) {
    val health = header.health
    val style = MaterialTheme.typography.labelMedium
    if (health != null && !health.isOnline) {
        Text(health.label(header.machineName), style = style, color = MaterialTheme.colorScheme.error, maxLines = 1, overflow = TextOverflow.Ellipsis)
        return
    }
    if (header.reconnecting) {
        Text(stringResource(R.string.chat_reconnecting), style = style, color = MaterialTheme.colorScheme.error, maxLines = 1, overflow = TextOverflow.Ellipsis)
        return
    }
    val parts = listOfNotNull(header.agent.name, header.folder, header.machineName.takeIf { it.isNotEmpty() })
    val subtitle = parts.joinToString(" · ")
    val elapsed = runStartedAt?.let { elapsedSince(it) }
    if (elapsed == null) {
        Text(subtitle, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        return
    }
    val working = BroskiTheme.semantic.working
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        Orb(OrbState.WORKING, size = 14.dp)
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = working, fontFeatureSettings = "tnum")) { append(elapsed) }
                append(" · $subtitle")
            },
            style = style,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** Seconds since [start], ticking once a second. */
@Composable
private fun elapsedSince(start: Long): String {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(start) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000L - now % 1_000L)
        }
    }
    return duration((now - start).coerceAtLeast(0))
}

@Composable
private fun OverflowWithRing(contextUsed: Float?, open: Boolean, onMenu: (Boolean) -> Unit, menu: @Composable (dismiss: () -> Unit) -> Unit) {
    Box(contentAlignment = Alignment.Center) {
        if (contextUsed != null) {
            CircularProgressIndicator(
                progress = { contextUsed },
                modifier = Modifier.size(40.dp),
                strokeWidth = 2.dp,
                trackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                color = if (contextUsed > 0.85f) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                gapSize = 0.dp,
            )
        }
        IconButton(onClick = { onMenu(true) }) {
            Icon(painterResource(R.drawable.ic_more_vert), contentDescription = stringResource(R.string.chat_more))
        }
        menu { onMenu(false) }
    }
}
