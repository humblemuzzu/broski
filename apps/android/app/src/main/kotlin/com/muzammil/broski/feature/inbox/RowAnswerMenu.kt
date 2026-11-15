package com.muzammil.broski.feature.inbox

import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.muzammil.broski.R

/** Approve and Deny for a row's pending tool permission; each item sends only on its tap. */
@Composable
fun RowAnswerMenu(
    expanded: Boolean,
    decisions: List<Decision>,
    busy: Boolean,
    onDismiss: () -> Unit,
    onAnswer: (Decision) -> Unit,
) {
    DropdownMenu(expanded = expanded && decisions.isNotEmpty(), onDismissRequest = onDismiss) {
        decisions.forEach { decision ->
            val tint = when (decision) {
                Decision.Approve -> MaterialTheme.colorScheme.primary
                Decision.Deny -> MaterialTheme.colorScheme.error
            }
            DropdownMenuItem(
                text = { Text(stringResource(decision.label)) },
                onClick = { onAnswer(decision) },
                enabled = !busy,
                leadingIcon = { Icon(painterResource(decision.icon), contentDescription = null, tint = tint) },
            )
        }
    }
}

val Decision.label: Int
    get() = when (this) {
        Decision.Approve -> R.string.inbox_approve
        Decision.Deny -> R.string.inbox_deny
    }

private val Decision.icon: Int
    get() = when (this) {
        Decision.Approve -> R.drawable.ic_check_circle
        Decision.Deny -> R.drawable.ic_block
    }
