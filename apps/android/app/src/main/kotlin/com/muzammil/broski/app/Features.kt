package com.muzammil.broski.app

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.feature.workspace.WorkspaceScreen

@Immutable
class FeatureContext(
    val phone: PhoneSession,
    val navigate: (Route) -> Unit,
    val back: () -> Unit,
)

/**
 * Phase 4.2's screens plug in here and nowhere else (apps/android/README.md, "Integration points").
 * The shell offers a destination only once its slot is filled.
 */
@Immutable
class Features(
    val session: (@Composable FeatureContext.(SessionRoute) -> Unit)? = null,
    val workspace: (@Composable FeatureContext.() -> Unit)? = null,
    val newSession: (@Composable FeatureContext.(dismiss: () -> Unit) -> Unit)? = null,
)

val BroskiFeatures = Features(workspace = { WorkspaceScreen(this) })
