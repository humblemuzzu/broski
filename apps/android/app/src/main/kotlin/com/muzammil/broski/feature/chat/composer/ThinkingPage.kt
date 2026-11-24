package com.muzammil.broski.feature.chat.composer

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Grouped
import uniffi.broski_contract.ModelSummary

/**
 * The model's thinking level on a slider: the level's name above it, rolling up as the level rises and
 * down as it falls, and under it what the level means. A level is chosen when the slider comes to rest
 * on it; the page stays, so the person can try another.
 */
@Composable
fun ThinkingPage(model: ModelSummary, chosen: String?, choose: (String) -> Unit) {
    val options = model.thinking.options
    val committed = options.indexOfFirst { it.value == (chosen ?: model.thinking.defaultValue) }.takeIf { it >= 0 }
    var shown by remember(model.id) { mutableStateOf(committed) }
    val latest by rememberUpdatedState(committed)
    val spatial = MaterialTheme.motionScheme.fastSpatialSpec<androidx.compose.ui.unit.IntOffset>()
    val effects = MaterialTheme.motionScheme.fastEffectsSpec<Float>()
    val title = shown?.let { options[it].title } ?: stringResource(R.string.composer_thinking_default)
    Column(Modifier.fillMaxWidth().padding(horizontal = Grouped.margin).padding(top = 36.dp, bottom = 40.dp)) {
        AnimatedContent(
            targetState = shown,
            transitionSpec = {
                val rising = (targetState ?: -1) > (initialState ?: -1)
                (slideInVertically(spatial) { if (rising) it else -it } + fadeIn(effects)) togetherWith
                    (slideOutVertically(spatial) { if (rising) -it else it } + fadeOut(effects)) using SizeTransform(clip = true)
            },
            contentAlignment = Alignment.Center,
            label = "thinking title",
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) { level ->
            Text(
                level?.let { options[it].title } ?: stringResource(R.string.composer_thinking_default),
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Medium),
            )
        }
        Spacer(Modifier.height(18.dp))
        ThinkingSlider(
            count = options.size,
            index = shown,
            label = stringResource(R.string.composer_thinking),
            value = title,
            onIndex = { shown = it },
            onCommit = { level -> if (level != latest) choose(options[level].value) },
        )
        Spacer(Modifier.height(36.dp))
        Text(
            shown?.let { options[it].description }?.takeIf { it.isNotBlank() } ?: stringResource(R.string.composer_thinking_about),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
    }
}

/**
 * The level in the band's row at a glance: a dot per level and a bar on the chosen one, sliding along
 * as it changes.
 */
@Composable
fun LevelDots(count: Int, index: Int?, modifier: Modifier = Modifier) {
    val slot = 9.dp
    val at by animateDpAsState(slot * (index ?: 0), MaterialTheme.motionScheme.fastSpatialSpec(), label = "level dots")
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    Box(modifier, contentAlignment = Alignment.CenterStart) {
        Row(horizontalArrangement = Arrangement.spacedBy(0.dp), verticalAlignment = Alignment.CenterVertically) {
            repeat(count) { level ->
                Box(Modifier.width(slot), contentAlignment = Alignment.Center) {
                    if (level != index) Box(Modifier.size(3.5.dp).background(color.copy(alpha = 0.7f), CircleShape))
                }
            }
        }
        if (index != null) {
            Box(Modifier.padding(start = at + (slot - 2.5.dp) / 2).size(2.5.dp, 14.dp).background(MaterialTheme.colorScheme.onSurface, CircleShape))
        }
    }
}
