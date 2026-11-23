package com.muzammil.broski.feature.chat.composer

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.GroupedRow
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import uniffi.broski_contract.ModelSummary

/**
 * Every model the agent lists, one section per provider, the chosen model's provider open and the rest
 * folded; a search opens them all and matches names, ids and providers. Each row picks its model, and
 * its pin keeps it on the sheet's first page.
 */
@Composable
fun ModelBrowser(models: List<ModelSummary>, chosen: String?, backend: String, pick: (ModelSummary) -> Unit) {
    val haptics = LocalHapticFeedback.current
    val preferences = LocalModelPreferences.current
    val query = rememberTextFieldState()
    val chosenProvider = models.firstOrNull { it.id == chosen }?.provider
    var open by remember { mutableStateOf(setOfNotNull(chosenProvider)) }
    val groups by remember(models) {
        derivedStateOf {
            val words = query.text.toString().lowercase().split(' ').filter { it.isNotBlank() }
            models
                .filter { model ->
                    val haystack = listOfNotNull(model.displayName, model.id, model.provider).joinToString(" ").lowercase()
                    words.all { it in haystack }
                }
                .groupBy { it.provider ?: "Models" }
                .toList()
                .sortedWith(compareBy<Pair<String, List<ModelSummary>>> { it.first != chosenProvider }.thenBy { it.first.lowercase() })
        }
    }
    val searching = query.text.isNotBlank()
    Column {
        OutlinedTextField(
            state = query,
            lineLimits = TextFieldLineLimits.SingleLine,
            placeholder = { Text(pluralStringResource(R.plurals.composer_search_models, models.size, models.size)) },
            leadingIcon = { Icon(painterResource(R.drawable.ic_search), contentDescription = null) },
            shape = CircleShape,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        )
        LazyColumn {
            groups.forEach { (provider, group) ->
                val expanded = searching || provider in open
                item(key = "provider:$provider") {
                    ProviderHeader(provider, group.size, expanded) {
                        open = if (provider in open) open - provider else open + provider
                    }
                }
                if (expanded) {
                    group.forEachIndexed { index, model ->
                        item(key = model.id) {
                            val isPinned = preferences.value.isPinned(model.id, backend)
                            GroupedRow(
                                index, group.size,
                                onClick = { pick(model) },
                                supporting = detail(model)?.let { { Text(it, maxLines = 1) } },
                                trailing = {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        if (model.id == chosen) Check()
                                        PinButton(model, isPinned, enabled = isPinned || preferences.value.canPin(backend)) {
                                            haptics.perform(Haptic.PickerStep)
                                            preferences.update { it.pinning(!isPinned, model.id, backend) }
                                        }
                                    }
                                },
                            ) { Text(model.displayName) }
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun ProviderHeader(provider: String, count: Int, expanded: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onToggle)
            .padding(horizontal = 28.dp, vertical = 12.dp)
            .semantics { heading() },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(provider, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
        Text(count.toString(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(
            painterResource(if (expanded) R.drawable.ic_keyboard_arrow_down else R.drawable.ic_chevron_right),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun PinButton(model: ModelSummary, pinned: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    IconButton(onClick = onToggle, enabled = enabled) {
        Icon(
            painterResource(R.drawable.ic_keep),
            contentDescription = stringResource(if (pinned) R.string.composer_unpin else R.string.composer_pin, model.displayName),
            tint = if (pinned) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f),
        )
    }
}

/** The model's own id without the provider its section already names, and its context window. */
private fun detail(model: ModelSummary): String? {
    val provider = model.providerId
    val id = if (provider != null && model.id.startsWith("$provider/")) model.id.removePrefix("$provider/") else model.id
    val context = model.contextWindow?.let(::tokens)
    return listOfNotNull(id.takeIf { it != model.displayName }, context).joinToString(" · ").ifEmpty { null }
}

private fun tokens(count: Long): String = when {
    count < 1_000 -> "$count"
    count < 1_000_000 -> "${count / 1_000}k"
    else -> "%.1fM".format(count / 1_000_000.0)
}
