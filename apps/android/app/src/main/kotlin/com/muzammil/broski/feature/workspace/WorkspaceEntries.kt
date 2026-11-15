package com.muzammil.broski.feature.workspace

import androidx.navigation3.runtime.EntryProviderScope
import com.muzammil.broski.app.DiffRoute
import com.muzammil.broski.app.FeatureContext
import com.muzammil.broski.app.FileRoute
import com.muzammil.broski.app.FilesRoute
import com.muzammil.broski.app.GitRoute
import com.muzammil.broski.app.Route
import com.muzammil.broski.app.TerminalRoute
import com.muzammil.broski.feature.workspace.files.FileScreen
import com.muzammil.broski.feature.workspace.files.FilesScreen
import com.muzammil.broski.feature.workspace.git.DiffScreen
import com.muzammil.broski.feature.workspace.git.GitScreen
import com.muzammil.broski.feature.workspace.terminal.TerminalScreen

/** The Workspace's screens below its tab, reachable from any tab (the chat opens a folder with [FilesRoute]). */
fun EntryProviderScope<Route>.workspaceEntries(context: FeatureContext) {
    entry<FilesRoute> { route -> FilesScreen(context, route) }
    entry<FileRoute> { route -> FileScreen(context, route) }
    entry<GitRoute> { route -> GitScreen(context, route) }
    entry<DiffRoute> { route -> DiffScreen(context, route) }
    entry<TerminalRoute> { route -> TerminalScreen(context, route) }
}
