package com.muzammil.broski.feature.chat.header

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.core.isOnline
import com.muzammil.broski.design.label
import com.muzammil.broski.feature.chat.ChatHeader

/**
 * The chat's header: back, the title (renamed on a tap) over the folder, or the machine's state in
 * words when it is not ready; then the overflow, the context ring drawn around it. What runs and for
 * how long is the status lane's to say. The bar takes its container only while the transcript runs
 * under it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatTopBar(
    header: ChatHeader,
    contextUsed: Float?,
    scrolledUnder: Boolean,
    onBack: () -> Unit,
    onRename: (() -> Unit)?,
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
        subtitle = { Subtitle(header) },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
            }
        },
        actions = { OverflowWithRing(contextUsed, menuOpen, onMenu, menu) },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = container, scrolledContainerColor = container),
        modifier = modifier,
    )
}

/** The folder, or why what shows may not be live. */
@Composable
private fun Subtitle(header: ChatHeader) {
    val health = header.health
    val problem = when {
        health != null && !health.isOnline -> health.label(header.machineName)
        header.reconnecting -> stringResource(R.string.chat_reconnecting)
        else -> null
    }
    val words = problem ?: header.folder ?: return
    Text(
        words,
        style = MaterialTheme.typography.labelMedium,
        color = if (problem != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
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
                color = if (contextUsed > 0.85f) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                gapSize = 0.dp,
            )
        }
        IconButton(onClick = { onMenu(true) }) {
            Icon(painterResource(R.drawable.ic_more_vert), contentDescription = stringResource(R.string.chat_more))
        }
        menu { onMenu(false) }
    }
}
