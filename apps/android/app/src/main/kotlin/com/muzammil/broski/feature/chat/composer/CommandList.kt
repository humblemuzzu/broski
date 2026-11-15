package com.muzammil.broski.feature.chat.composer

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.muzammil.broski.design.mono
import uniffi.broski_contract.CommandSummary

/**
 * The commands a `/` at the start of the field asks for, filtered by what follows it: names that
 * start with it first, then names that contain it. Empty once a space ends the name.
 */
fun matchingCommands(text: String, commands: List<CommandSummary>): List<CommandSummary> {
    if (!text.startsWith("/") || text.contains(' ') || text.contains('\n')) return emptyList()
    val query = text.drop(1)
    val starting = commands.filter { it.name.startsWith(query, ignoreCase = true) }
    return starting + commands.filter { it !in starting && it.name.contains(query, ignoreCase = true) }
}

/** The matching commands over the composer; picking one sets the prompt's command. */
@Composable
fun CommandList(commands: List<CommandSummary>, onPick: (CommandSummary) -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 2.dp,
    ) {
        LazyColumn(Modifier.heightIn(max = 240.dp).padding(vertical = 6.dp)) {
            items(commands, key = { it.id }) { command ->
                Row(Modifier.fillMaxWidth().clickable { onPick(command) }.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    Column {
                        Text(
                            "/${command.name}" + (command.argumentHint?.let { " $it" } ?: ""),
                            style = MaterialTheme.typography.bodyMedium.mono(),
                        )
                        command.description?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}
