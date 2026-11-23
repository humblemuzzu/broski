package com.muzammil.broski.feature.workspace.git

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import com.muzammil.broski.R
import uniffi.broski_contract.GitUpstream

/** "2 ahead, 1 behind origin/main", or "Up to date with origin/main". */
@Composable
fun GitUpstream.summary(): String {
    val parts = buildList {
        if (ahead > 0) add(pluralStringResource(R.plurals.git_ahead, ahead.toInt(), ahead))
        if (behind > 0) add(pluralStringResource(R.plurals.git_behind, behind.toInt(), behind))
    }
    return if (parts.isEmpty()) {
        stringResource(R.string.git_upstream_up_to_date, name)
    } else {
        stringResource(R.string.git_upstream_summary, parts.joinToString(", "), name)
    }
}
