package com.muzammil.broski.feature.chat.work

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.code.DiffView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import uniffi.broski_contract.FileChange
import uniffi.broski_core.DiffFile
import uniffi.broski_core.fileChangeDiff

/** A file change's diff over the chat, the whole height; back or a drag down puts it away. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DiffSheet(change: FileChange, onDismiss: () -> Unit) {
    val file by produceState<DiffFile?>(null, change) { value = withContext(Dispatchers.Default) { fileChangeDiff(change) } }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        val shown = file
        when {
            shown == null -> Unit
            shown.hunks.isEmpty() -> Text(
                stringResource(R.string.chat_diff_none),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.fillMaxWidth().padding(24.dp),
            )
            else -> DiffView(shown, wrap = false, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp))
        }
    }
}
