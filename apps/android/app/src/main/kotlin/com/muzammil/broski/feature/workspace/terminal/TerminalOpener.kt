package com.muzammil.broski.feature.workspace.terminal

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import com.muzammil.broski.app.Route
import com.muzammil.broski.app.TerminalRoute
import com.muzammil.broski.feature.workspace.Answer
import com.muzammil.broski.feature.workspace.WorkspaceClient
import com.muzammil.broski.feature.workspace.WorkspaceFailure
import kotlinx.coroutines.launch
import uniffi.broski_core.Machine

/**
 * Opens a new terminal in a folder and shows it. It opens at the classic 80×24; the terminal
 * screen resizes it to what fits as soon as it is laid out.
 */
@Composable
fun rememberTerminalOpener(
    machine: Machine,
    machineId: String,
    navigate: (Route) -> Unit,
    onFailure: (WorkspaceFailure) -> Unit,
): (cwd: String) -> Unit {
    val scope = rememberCoroutineScope()
    val currentNavigate = rememberUpdatedState(navigate)
    val currentFailure = rememberUpdatedState(onFailure)
    return remember(machine, machineId) {
        { cwd ->
            scope.launch {
                when (val answer = WorkspaceClient(machine::request).openTerminal(cwd, cols = 80, rows = 24)) {
                    is Answer.Done -> currentNavigate.value(TerminalRoute(machineId, answer.value.id, answer.value.cwd))
                    is Answer.Failed -> currentFailure.value(answer.failure)
                }
            }
        }
    }
}
