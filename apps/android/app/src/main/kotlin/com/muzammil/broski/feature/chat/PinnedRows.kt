package com.muzammil.broski.feature.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import uniffi.broski_contract.NoticeLevel
import uniffi.broski_contract.QueueItem
import uniffi.broski_contract.QueuedDelivery

/** A notice or error the agent showed: one plain sentence with its icon, put away with a tap. */
@Composable
fun NoticeCard(notice: ChatNotice, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    val error = notice.level == NoticeLevel.ERROR
    Surface(
        shape = MaterialTheme.shapes.large,
        color = if (error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = if (error) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val icon = when (notice.level) {
                NoticeLevel.INFO -> R.drawable.ic_info
                NoticeLevel.WARNING -> R.drawable.ic_warning
                NoticeLevel.ERROR -> R.drawable.ic_error
            }
            Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(20.dp))
            Text(notice.text, style = MaterialTheme.typography.bodyMedium, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(vertical = 12.dp))
            IconButton(onClick = onDismiss) {
                Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.chat_dismiss_notice))
            }
        }
    }
}

/** A message waiting for its turn, quiet, with a cancel when the backend can take one back. */
@Composable
fun QueuedRow(item: QueueItem, onCancel: (() -> Unit)?, modifier: Modifier = Modifier) {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(
                painterResource(if (item.delivery == QueuedDelivery.STEER) R.drawable.ic_alt_route else R.drawable.ic_playlist_add),
                contentDescription = stringResource(if (item.delivery == QueuedDelivery.STEER) R.string.chat_queued_steer else R.string.chat_queued),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
            Text(
                item.preview,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(vertical = 14.dp),
            )
            if (onCancel != null) {
                IconButton(onClick = onCancel) {
                    Icon(painterResource(R.drawable.ic_close), contentDescription = stringResource(R.string.chat_cancel_queued))
                }
            }
        }
    }
}
