package com.muzammil.broski.design

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.muzammil.broski.R
import com.muzammil.broski.design.orb.OrbSize
import com.muzammil.broski.design.orb.OrbState
import com.muzammil.broski.design.orb.OrbTheme
import com.muzammil.broski.design.orb.ThinkingOrb

/**
 * The one sign that something is under way: a thinking orb sized with the text beside it and hidden
 * from TalkBack, because that text says what is under way. Under 40 dp it draws the library's 20 dp
 * design, above it the 64 dp one. It rests on one still frame when [still], while the screen is not
 * resumed and when animations are off, as the shimmer does.
 */
@Composable
fun Orb(
    state: OrbState,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
    theme: OrbTheme = OrbTheme.AUTO,
    still: Boolean = false,
) {
    val side = with(LocalDensity.current) { size.value.sp.toDp() }
    val resumed by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    ThinkingOrb(
        modifier = modifier.clearAndSetSemantics {},
        state = state,
        size = if (side < 40.dp) OrbSize.PX20 else OrbSize.PX64,
        theme = theme,
        paused = still || !resumed.isAtLeast(Lifecycle.State.RESUMED),
        displaySize = side,
    )
}

/** Waiting on the Mac in place of a spinner, with no words beside it: an orb TalkBack reads as [label]. */
@Composable
fun LoadingOrb(
    modifier: Modifier = Modifier,
    state: OrbState = OrbState.SEARCHING,
    size: Dp = 20.dp,
    theme: OrbTheme = OrbTheme.AUTO,
    label: String = stringResource(R.string.orb_loading),
) {
    Box(
        modifier.semantics {
            contentDescription = label
            progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
        },
    ) {
        Orb(state, size = size, theme = theme)
    }
}
