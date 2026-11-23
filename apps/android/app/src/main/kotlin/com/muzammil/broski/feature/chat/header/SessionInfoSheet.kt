package com.muzammil.broski.feature.chat.header

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.design.BroskiTheme
import com.muzammil.broski.design.GlassCircleButton
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.workspace.shortPath
import com.muzammil.broski.feature.chat.CacheStatus
import com.muzammil.broski.feature.chat.cacheDuration
import com.muzammil.broski.feature.chat.cacheNow
import com.muzammil.broski.feature.chat.cacheStatus
import com.muzammil.broski.feature.chat.color
import com.muzammil.broski.feature.chat.tone
import kotlinx.coroutines.delay
import uniffi.broski_contract.CacheWindow

/**
 * Session Info, from the chat's overflow: a pinned top row (the agent's mark, the title, the agent
 * and Mac, a round close button), then how full its context is with what it used, its model and
 * settings, its folder and id to copy, and its prompt cache counting down. Every row is a label and a
 * value on one line. [home] writes the folder from `~` once the Mac said where its home is.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionInfoSheet(info: SessionInfo, home: String?, onCopy: (label: String, value: String) -> Unit, onDismiss: () -> Unit) {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val sheet = if (dark) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surfaceContainer
    val card = if (dark) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceContainerLowest
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(), containerColor = sheet) {
        Column(Modifier.fillMaxWidth()) {
            InfoHeader(info, onCopy, onDismiss)
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 4.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                info.usage?.let { ContextUsage(it, info.contextWindow, card) }
                ModelSettings(info, card)
                Details(info, home, onCopy, card)
                info.usage?.cache?.let { PromptCache(it, card) }
            }
        }
    }
}

private val sectionTone: Color
    @Composable get() = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.8f)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun InfoHeader(info: SessionInfo, onCopy: (String, String) -> Unit, onDismiss: () -> Unit) {
    val title = info.title ?: stringResource(R.string.inbox_untitled)
    val copyTitle = stringResource(R.string.info_copy_title)
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AgentMark(info.agent, size = 40.dp)
        Column(
            Modifier.weight(1f).combinedClickable(onClickLabel = null, onLongClickLabel = copyTitle, onLongClick = { onCopy(copyTitle, title) }) {},
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(title, fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
            Text(
                listOf(info.agent.name, info.machineName).filter { it.isNotEmpty() }.joinToString(" · "),
                fontSize = 15.sp,
                color = sectionTone,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        GlassCircleButton(R.drawable.ic_close, stringResource(R.string.info_close), onDismiss)
    }
}

@Composable
private fun ContextUsage(usage: uniffi.broski_contract.Usage, window: Long?, card: Color) {
    val fill = contextFill(usage.contextTokens, window)
    val bare = if (fill == null) contextOnly(usage.contextTokens) else null
    val facts = usage.facts()
    if (fill == null && bare == null && facts.isEmpty()) return
    Group(R.string.info_context_usage, card) {
        var first = true
        if (fill != null || bare != null) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 11.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Line(stringResource(R.string.info_context_window), fill?.let { stringResource(R.string.info_context_fill, it.label, it.percent) } ?: bare!!, padded = false)
                fill?.let {
                    LinearProgressIndicator(
                        progress = { it.fraction },
                        modifier = Modifier.fillMaxWidth(),
                        color = if (it.fraction > 0.85f) BroskiTheme.semantic.caution else MaterialTheme.colorScheme.primary,
                        drawStopIndicator = {},
                    )
                }
            }
            first = false
        }
        facts.forEach { fact ->
            if (!first) RowDivider()
            Line(stringResource(fact.label), fact.value)
            first = false
        }
    }
}

@Composable
private fun ModelSettings(info: SessionInfo, card: Color) {
    val lines = listOfNotNull(
        info.model?.let { stringResource(R.string.info_model) to it },
        info.provider?.let { stringResource(R.string.info_provider) to it },
        info.thinking?.let { stringResource(R.string.info_thinking) to it },
    ) + info.modes
    if (lines.isEmpty()) return
    Group(R.string.info_model_settings, card) {
        lines.forEachIndexed { index, (label, value) ->
            if (index > 0) RowDivider()
            Line(label, value)
        }
    }
}

@Composable
private fun Details(info: SessionInfo, home: String?, onCopy: (String, String) -> Unit, card: Color) {
    Group(R.string.info_details, card) {
        info.cwd?.let { cwd ->
            CopyLine(stringResource(R.string.info_folder), cwd, shortPath(cwd, home), onCopy)
            RowDivider()
        }
        CopyLine(stringResource(R.string.info_session_id), info.sessionId, info.sessionId, onCopy)
    }
}

/** A row like every other that copies [value] on a tap and says "Copied" in its place for a moment. */
@Composable
private fun CopyLine(label: String, value: String, shown: String, onCopy: (String, String) -> Unit) {
    val haptics = LocalHapticFeedback.current
    var copies by remember { mutableIntStateOf(0) }
    LaunchedEffect(copies) {
        if (copies > 0) {
            delay(1_500)
            copies = 0
        }
    }
    Row(
        Modifier.fillMaxWidth().clickable(onClickLabel = stringResource(R.string.info_copy, label)) {
            onCopy(label, value)
            haptics.perform(Haptic.Success)
            copies += 1
        },
    ) {
        AnimatedContent(copies > 0, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "copied") { copied ->
            Line(label, if (copied) stringResource(R.string.info_copied) else shown, middle = true)
        }
    }
}

@Composable
private fun PromptCache(cache: CacheWindow, card: Color) {
    val now = cacheNow(cache)
    val status = cacheStatus(cache, now)
    val ofPrompt = stringResource(R.string.info_cached_of)
    val tokens = stringResource(R.string.info_cached_tokens)
    val words = CacheWords({ cached, prompt -> ofPrompt.format(cached, prompt) }, { tokens.format(it) }, stringResource(R.string.info_cache_about))
    val lines = cache.infoLines(now, words)
    val warm = (status as? CacheStatus.Warm)?.let { stringResource(R.string.info_cache_left, cacheDuration(it.remainingMs, it.estimated)) }
    if (warm == null && lines.isEmpty()) return
    Group(R.string.chat_prompt_cache, card) {
        warm?.let { Line(stringResource(R.string.info_warm), it, valueColor = status?.tone?.color()) }
        lines.forEachIndexed { index, line ->
            if (index > 0 || warm != null) RowDivider()
            Line(stringResource(line.label), line.value)
        }
    }
}

@Composable
private fun Line(label: String, value: String, padded: Boolean = true, middle: Boolean = false, valueColor: Color? = null) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = if (padded) 44.dp else 0.dp).then(if (padded) Modifier.padding(horizontal = 16.dp, vertical = 11.dp) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
        Text(
            value,
            style = MaterialTheme.typography.bodyLarge.tabular(),
            color = valueColor ?: MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = if (middle) TextOverflow.MiddleEllipsis else TextOverflow.Ellipsis,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1f).padding(start = 12.dp),
        )
    }
}

@Composable
private fun RowDivider() {
    HorizontalDivider(Modifier.padding(start = 16.dp), thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
private fun Group(title: Int, card: Color, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(title),
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            color = sectionTone,
            modifier = Modifier.padding(start = 16.dp).semantics { heading() },
        )
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(card), content = content)
    }
}

private fun TextStyle.tabular() = copy(fontFeatureSettings = "tnum")
