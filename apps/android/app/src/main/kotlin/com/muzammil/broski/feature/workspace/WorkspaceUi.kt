package com.muzammil.broski.feature.workspace

import android.content.res.Resources
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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

/** What could not be read or done, in plain words, with Try again. */
@Composable
fun FailureMessage(
    failure: WorkspaceFailure,
    onRetry: (() -> Unit)?,
    modifier: Modifier = Modifier,
    @StringRes notFound: Int? = null,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            painterResource(R.drawable.ic_error),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(32.dp),
        )
        Text(
            failure.sentence(notFound),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        failure.extra?.let {
            Text(
                stringResource(R.string.error_details, it),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        onRetry?.let { QuietButton(stringResource(R.string.workspace_try_again), it) }
    }
}

/** A top bar naming a place on the Mac: its name, and its full path under it in monospace. */
@Composable
fun PathTopBar(
    title: String,
    path: String?,
    onBack: () -> Unit,
    scrollBehavior: TopAppBarScrollBehavior? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = {
            Column {
                Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                path?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelMedium.mono(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.StartEllipsis,
                    )
                }
            }
        },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(painterResource(R.drawable.ic_arrow_back), contentDescription = stringResource(R.string.action_back))
            }
        },
        actions = actions,
        scrollBehavior = scrollBehavior,
    )
}
