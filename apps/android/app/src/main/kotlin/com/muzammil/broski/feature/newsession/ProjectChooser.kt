package com.muzammil.broski.feature.newsession

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.text.TextStyle
import com.muzammil.broski.design.Glass
import com.muzammil.broski.design.glassShadow
import com.muzammil.broski.R
import com.muzammil.broski.core.Agent
import com.muzammil.broski.core.AgentInstall
import com.muzammil.broski.design.AgentMark
import com.muzammil.broski.feature.workspace.lastComponent
import com.muzammil.broski.feature.workspace.parentPath
import com.muzammil.broski.feature.workspace.shortPath
import uniffi.broski_contract.AuthState

/** The composer's shape, which the card above it shares. */
internal val ComposerShape = RoundedCornerShape(26.dp)

/**
 * The folders this Mac's sessions ran in, newest first, the chosen one lit; then All projects for the
 * rest and for any folder on the Mac. One card above the composer, in the composer's own surface.
 */
@Composable
internal fun ProjectCard(projects: List<Project>, selected: String?, home: String?, onPick: (String) -> Unit, onBrowse: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().glassShadow(ComposerShape),
        shape = ComposerShape,
        color = Glass.fill,
        border = BorderStroke(0.5.dp, Glass.edge),
    ) {
        Column(Modifier.padding(4.dp)) {
            projects.forEach { project ->
                val chosen = project.path == selected
                val twin = projects.any { it != project && lastComponent(it.path) == lastComponent(project.path) }
                ChooserRow(
                    icon = if (chosen) R.drawable.ic_folder_open else R.drawable.ic_folder,
                    title = lastComponent(project.path),
                    detail = if (twin) shortPath(parentPath(project.path), home) else null,
                    chosen = chosen,
                    onClick = { onPick(project.path) },
                )
            }
            ChooserRow(
                icon = if (projects.isEmpty()) R.drawable.ic_folder_open else R.drawable.ic_search,
                title = stringResource(if (projects.isEmpty()) R.string.new_session_choose_folder else R.string.new_session_all_projects),
                detail = null,
                chosen = false,
                onClick = onBrowse,
                accent = projects.isEmpty(),
            )
        }
    }
}

@Composable
private fun ChooserRow(@DrawableRes icon: Int, title: String, detail: String?, chosen: Boolean, onClick: () -> Unit, accent: Boolean = false) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(22.dp),
        color = if (chosen) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f) else Color.Transparent,
        contentColor = MaterialTheme.colorScheme.onSurface,
        modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp).semantics { selected = chosen },
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painterResource(icon),
                contentDescription = null,
                tint = when {
                    chosen || accent -> MaterialTheme.colorScheme.primary
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.size(22.dp),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (chosen) FontWeight.SemiBold else null,
                    color = if (accent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.MiddleEllipsis,
                )
                detail?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.StartEllipsis)
                }
            }
        }
    }
}

/**
 * The agent and the folder the session starts with, as two pills over the composer. The agent is a
 * menu, where one that cannot run says why; the folder opens and closes the list above.
 */
@Composable
internal fun SessionPills(
    agents: List<AgentInstall>,
    chosen: Agent?,
    machineName: String,
    folder: String?,
    showsProjects: Boolean,
    onAgent: (String) -> Unit,
    onFolder: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        AgentPill(agents, chosen, machineName, onAgent)
        Pill(onClick = onFolder, modifier = Modifier.weight(1f, fill = false)) {
            Icon(painterResource(R.drawable.ic_folder), contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
            Text(
                folder?.let(::lastComponent) ?: stringResource(R.string.new_session_pick_folder),
                maxLines = 1,
                overflow = TextOverflow.MiddleEllipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Icon(
                painterResource(if (showsProjects) R.drawable.ic_keyboard_arrow_down else R.drawable.ic_keyboard_arrow_up),
                contentDescription = stringResource(if (showsProjects) R.string.new_session_hide_folders else R.string.new_session_show_folders),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun AgentPill(agents: List<AgentInstall>, chosen: Agent?, machineName: String, onAgent: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        Pill(onClick = { open = true }) {
            chosen?.let { AgentMark(it, size = 20.dp) }
            Text(chosen?.name ?: stringResource(R.string.new_session_agent))
            Icon(painterResource(R.drawable.ic_keyboard_arrow_down), contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            agents.forEach { agent ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(agent.agent.name)
                            unusable(agent, machineName)?.let {
                                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    },
                    leadingIcon = { AgentMark(agent.agent, size = 28.dp) },
                    trailingIcon = if (agent.backend == chosen?.id) ({ Icon(painterResource(R.drawable.ic_check), contentDescription = null) }) else null,
                    enabled = agent.canRun,
                    onClick = {
                        open = false
                        onAgent(agent.backend)
                    },
                    modifier = Modifier.widthIn(min = 220.dp),
                )
            }
        }
    }
}

@Composable
private fun Pill(onClick: () -> Unit, modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = Glass.fill,
        border = BorderStroke(0.5.dp, Glass.edge),
        modifier = modifier.glassShadow(CircleShape).heightIn(min = 36.dp).semantics { role = Role.Button },
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ProvideTextStyle(TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)) { content() }
        }
    }
}

/** Why the agent cannot run: not installed, signed out, or its own words. */
@Composable
private fun unusable(agent: AgentInstall, machineName: String): String? {
    val status = agent.status ?: return null
    if (status.usable) return null
    status.issues.firstOrNull()?.let { return it.message }
    return when {
        !status.installed -> stringResource(R.string.new_session_agent_missing, machineName)
        status.auth == AuthState.SIGNED_OUT -> stringResource(R.string.new_session_agent_signed_out, machineName)
        else -> stringResource(R.string.new_session_agent_cannot_run)
    }
}
