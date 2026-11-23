package com.muzammil.broski.feature.usage

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle

/**
 * A figure whose digits roll to their new values, as SwiftUI's numeric text does: each place slides
 * up when it rises and down when it falls, places counted from the right so they stay put as the figure grows.
 */
@Composable
fun NumericText(text: String, style: TextStyle, modifier: Modifier = Modifier, color: Color = Color.Unspecified) {
    Row(modifier.clearAndSetSemantics { contentDescription = text }) {
        text.forEachIndexed { index, _ ->
            key(text.length - 1 - index) {
                AnimatedContent(
                    targetState = text[index],
                    transitionSpec = {
                        val up = targetState > initialState
                        (slideInVertically(tween(DURATION_MS)) { if (up) it else -it } + fadeIn(tween(DURATION_MS))) togetherWith
                            (slideOutVertically(tween(DURATION_MS)) { if (up) -it else it } + fadeOut(tween(DURATION_MS)))
                    },
                    label = "digit",
                ) { char -> Text(char.toString(), style = style, color = color, maxLines = 1, softWrap = false) }
            }
        }
    }
}

private const val DURATION_MS = 250
