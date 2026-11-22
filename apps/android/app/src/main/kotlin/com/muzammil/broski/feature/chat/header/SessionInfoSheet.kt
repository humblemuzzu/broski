package com.muzammil.broski.feature.chat.header

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.design.MonoFamily
import com.muzammil.broski.feature.chat.CacheStatus
import com.muzammil.broski.feature.chat.breakdown
import com.muzammil.broski.feature.chat.cacheDuration
import com.muzammil.broski.feature.chat.cacheNow
import com.muzammil.broski.feature.chat.cacheStatus
import com.muzammil.broski.feature.chat.color
import com.muzammil.broski.feature.chat.tone
import uniffi.broski_contract.CacheWindow
import uniffi.broski_contract.Usage

/**
 * Session info: who and where, the model and its settings, the context and tokens it used, and the
 * prompt cache counting down. [onCopy] puts a value on the clipboard; the copied row shows a check.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionInfoSheet(info: SessionInfo, onCopy: (label: String, value: String) -> Unit, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Heading(info)
            Details(info, onCopy)
            ModelSettings(info)
            info.usage?.let { ContextUsage(it, info.contextWindow) }
            info.usage?.cache?.let { PromptCache(it) }
        }
    }
}

@Composable
private fun Heading(info: SessionInfo) {
    val title = info.title ?: stringResource(R.string.inbox_untitled)
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        AgentMark(info.agent, size = 48.dp)
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 3, overflow = TextOverflow.Ellipsis)
            Text(info.agent.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Details(info: SessionInfo, onCopy: (String, String) -> Unit) {
    var copied by remember { mutableStateOf<String?>(null) }
    val copy = { label: String, value: String ->
        onCopy(label, value)
        copied = value
    }
    Group(R.string.info_details) {
        if (info.machineName.isNotEmpty()) Fact(stringResource(R.string.info_machine), info.machineName)
        val idLabel = stringResource(R.string.info_session_id)
        Fact(idLabel, info.sessionId, mono = true, copied = copied == info.sessionId) { copy(idLabel, info.sessionId) }
        info.cwd?.let { cwd ->
            val folderLabel = stringResource(R.string.info_folder)
            Fact(folderLabel, cwd, mono = true, copied = copied == cwd) { copy(folderLabel, cwd) }
        }
    }
}

@Composable
private fun ModelSettings(info: SessionInfo) {
    if (info.model == null && info.thinking == null && info.modes.isEmpty()) return
    Group(R.string.info_model_settings) {
        info.model?.let { Fact(stringResource(R.string.info_model), it) }
        info.modelId?.let { Fact(stringResource(R.string.info_model_id), it, mono = true) }
        info.thinking?.let { Fact(stringResource(R.string.info_thinking), it) }
        info.modes.forEach { (axis, option) -> Fact(axis, option) }
    }
}

@Composable
private fun ContextUsage(usage: Usage, window: Long?) {
    val fill = contextFill(usage.contextTokens, window)
    val facts = usage.facts()
    if (fill == null && facts.isEmpty()) return
    Group(R.string.info_context_usage) {
        fill?.let {
            Fact(stringResource(R.string.info_context_window), stringResource(R.string.info_context_fill, it.label, it.percent))
            LinearProgressIndicator(
                progress = { it.fraction },
                modifier = Modifier.fillMaxWidth(),
                color = if (it.fraction > 0.85f) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            )
        }
        facts.forEach { Fact(stringResource(it.label), it.value) }
    }
}

@Composable
private fun PromptCache(cache: CacheWindow) {
    val now = cacheNow(cache)
    val status = cacheStatus(cache, now)
    val lines = cache.breakdown(now)
    val countdown = when {
        status is CacheStatus.Warm -> stringResource(R.string.info_cache_left, cacheDuration(status.remainingMs, status.estimated))
        cache.ttlMs != null -> stringResource(R.string.info_cache_expired)
        else -> null
    }
    if (countdown == null && lines.isEmpty()) return
    Group(R.string.chat_prompt_cache) {
        countdown?.let {
            val tone = status?.tone?.color() ?: MaterialTheme.colorScheme.onSurfaceVariant
            Text(it, style = MaterialTheme.typography.titleMedium.tabular(), color = tone)
        }
        lines.forEach { line -> Text(line, style = MaterialTheme.typography.bodyMedium.tabular()) }
    }
}

@Composable
private fun Group(title: Int, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(title),
            style = MaterialTheme.typography.titleSmallEmphasized,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.semantics { heading() },
        )
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
        }
    }
}

@Composable
private fun Fact(label: String, value: String, mono: Boolean = false, copied: Boolean = false, onCopy: (() -> Unit)? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val style = MaterialTheme.typography.bodyLarge
            Text(value, style = if (mono) style.copy(fontFamily = MonoFamily, fontSize = MaterialTheme.typography.bodyMedium.fontSize) else style)
        }
        if (onCopy != null) {
            IconButton(onClick = onCopy) {
                Icon(
                    painterResource(if (copied) R.drawable.ic_check else R.drawable.ic_content_copy),
                    contentDescription = stringResource(R.string.info_copy, label),
                    tint = if (copied) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun TextStyle.tabular() = copy(fontFeatureSettings = "tnum")
