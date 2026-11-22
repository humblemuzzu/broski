package com.muzammil.broski.feature.chat.composer

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.chat.CacheSwitchNotice
import uniffi.broski_contract.CacheWindow
import uniffi.broski_contract.ModelSummary

/** Every model, searchable by name or provider, the one in use checked; picking one closes the sheet. A warm prompt cache says what switching costs. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelSheet(models: List<ModelSummary>, selected: String?, cache: CacheWindow?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val query = rememberTextFieldState()
    val shown by remember(models) {
        derivedStateOf {
            val words = query.text.toString().trim()
            models.filter { words.isEmpty() || it.displayName.contains(words, true) || it.providerName.orEmpty().contains(words, true) }
        }
    }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.composer_model), style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            CacheSwitchNotice(cache)
            OutlinedTextField(
                state = query,
                lineLimits = TextFieldLineLimits.SingleLine,
                placeholder = { Text(stringResource(R.string.composer_search_models)) },
                leadingIcon = { Icon(painterResource(R.drawable.ic_search), contentDescription = null) },
                shape = CircleShape,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        LazyColumn(Modifier.fillMaxWidth()) {
            items(shown, key = { it.id }) { model ->
                ListItem(
                    headlineContent = { Text(model.displayName) },
                    supportingContent = (model.providerName ?: model.providerId)?.let { provider -> { Text(provider) } },
                    trailingContent = if (model.id == selected) {
                        { Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = MaterialTheme.colorScheme.primary) }
                    } else {
                        null
                    },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
                    modifier = Modifier.clickable {
                        haptics.perform(Haptic.PickerStep)
                        onPick(model.id)
                        onDismiss()
                    },
                )
            }
        }
    }
}
