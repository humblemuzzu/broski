package com.muzammil.broski.feature.chat.transcript

import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.muzammil.broski.R
import uniffi.broski_contract.LinkItem
import uniffi.broski_core.formatPlainText

/** Rows shown before "Show N more sources". */
private const val SHOWN_SOURCES = 4

/**
 * The pages an answer's searches found, under it: one row each with its title and its site, the way a
 * reader checks where a claim came from. Each opens in Custom Tabs.
 */
@Composable
fun SourcesList(sources: List<LinkItem>, modifier: Modifier = Modifier) {
    var showsAll by rememberSaveable { mutableStateOf(false) }
    val visible = if (showsAll) sources else sources.take(SHOWN_SOURCES)
    val label = stringResource(R.string.chat_sources)
    Column(modifier.fillMaxWidth().semantics { contentDescription = label }) {
        visible.forEachIndexed { index, item ->
            if (index > 0) HorizontalDivider(Modifier.padding(start = 28.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))
            SourceRow(item)
        }
        if (sources.size > SHOWN_SOURCES && !showsAll) {
            val more = sources.size - SHOWN_SOURCES
            TextButton(onClick = { showsAll = true }) {
                Text(pluralStringResource(R.plurals.chat_sources_more, more, more), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SourceRow(item: LinkItem) {
    val context = LocalContext.current
    val host = item.url.toUri().host?.removePrefix("www.") ?: item.url
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .clickable { CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, item.url.toUri()) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(painterResource(R.drawable.ic_language), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        Text(
            if (item.title.isBlank()) item.url else formatPlainText(item.title),
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(host, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}
