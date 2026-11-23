package com.muzammil.broski.feature.workspace

import android.content.res.Resources
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.muzammil.broski.design.GlassCircleButton
import com.muzammil.broski.design.GlassMetrics
import com.muzammil.broski.design.GlassSurface
import com.muzammil.broski.design.SoftTopBar
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.LoadingOrb
import com.muzammil.broski.design.QuietButton
import com.muzammil.broski.design.mono

/** The plain sentence for a failure; git's own words when git refused. */
fun WorkspaceFailure.sentence(resources: Resources, @StringRes notFound: Int? = null): String = when {
    reason == WorkspaceFailure.Reason.Refused && !detail.isNullOrBlank() -> detail
    reason == WorkspaceFailure.Reason.NotFound && notFound != null -> resources.getString(notFound)
    else -> resources.getString(reason.sentence)
}

@Composable
fun WorkspaceFailure.sentence(@StringRes notFound: Int? = null): String = sentence(LocalResources.current, notFound)

/** The bridge's words under our sentence, when they add something. */
val WorkspaceFailure.extra: String?
    get() = detail?.takeIf { it.isNotBlank() && reason != WorkspaceFailure.Reason.Refused }

@Composable
fun WorkspaceLoading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        LoadingOrb(size = 64.dp, label = stringResource(R.string.workspace_loading))
    }
}

/** What could not be read or done: the sentence, the Mac's own words under it, and Try Again. */
@Composable
fun FailureMessage(
    failure: WorkspaceFailure,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
    @StringRes notFound: Int? = null,
) {
    ContentUnavailable(
        icon = R.drawable.ic_warning,
        title = failure.sentence(notFound),
        modifier = modifier,
        detail = failure.extra,
        actions = onRetry?.let { retry -> { QuietButton(stringResource(R.string.workspace_try_again), retry) } },
    )
}

/**
 * A workspace screen's bar as iOS draws it over the content: a round glass back button, the place's
 * name centred (a plain [path] under it, such as a diff's "Staged"; a [mono] path is the screen's own
 * business and stays out of the bar), and the screen's actions on a glass capsule.
 */
@Composable
fun PathTopBar(
    title: String,
    path: String?,
    onBack: () -> Unit,
    @Suppress("UNUSED_PARAMETER") scrollBehavior: TopAppBarScrollBehavior? = null,
    containerColor: Color = MaterialTheme.colorScheme.surface,
    mono: Boolean = true,
    actions: @Composable RowScope.() -> Unit = {},
) {
    SoftTopBar(containerColor) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            GlassCircleButton(R.drawable.ic_chevron_left, stringResource(R.string.action_back), onBack)
            Column(Modifier.weight(1f).padding(horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    title,
                    fontSize = 17.sp,
                    lineHeight = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.MiddleEllipsis,
                    modifier = Modifier.semantics { heading() },
                )
                if (path != null && !mono) {
                    Text(path, fontSize = 12.sp, lineHeight = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
            BarActions(actions)
        }
    }
}

/** The bar's actions on one glass capsule, or room the back button's width when there are none, so the title stays centred. */
@Composable
private fun BarActions(actions: @Composable RowScope.() -> Unit) {
    SubcomposeLayout { constraints ->
        val measured = subcompose("actions") { Row(verticalAlignment = Alignment.CenterVertically, content = actions) }.map { it.measure(constraints) }
        val empty = measured.all { it.width == 0 }
        val shown = subcompose("shown") {
            if (empty) {
                Spacer(Modifier.size(GlassMetrics.control))
            } else {
                GlassSurface(CircleShape, Modifier.heightIn(min = GlassMetrics.control)) {
                    Row(Modifier.padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
                }
            }
        }.map { it.measure(constraints) }
        val width = shown.maxOfOrNull { it.width } ?: 0
        val height = shown.maxOfOrNull { it.height } ?: 0
        layout(width, height) { shown.forEach { it.place(0, 0) } }
    }
}
