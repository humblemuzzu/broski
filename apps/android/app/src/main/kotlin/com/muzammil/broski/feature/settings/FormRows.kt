package com.muzammil.broski.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.IosSwitch
import com.muzammil.broski.design.perform
import com.muzammil.broski.design.IosText

/**
 * The rows of an iOS `Form`, for the settings screens: one line each, the title on the left and its
 * value or control on the right, in an inset card on the grouped grey, headers and footers around it.
 */
object Form {
    val rowHeight = 52.dp
    val separatorInset = 20.dp
}

/** A section's title over its card. */
@Composable
fun FormHeader(text: String) {
    Text(
        text,
        style = IosText.body.copy(fontWeight = FontWeight.SemiBold),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 36.dp, end = 36.dp, top = 24.dp, bottom = 10.dp).semantics { heading() },
    )
}

/** The quiet words under a section's card. */
@Composable
fun FormFooter(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = IosText.footnote.copy(lineHeight = 17.sp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(start = 36.dp, end = 36.dp, top = 10.dp),
    )
}

/** The room between two sections that have no header between them. */
fun LazyListScope.formGap(key: String) {
    item(key = key) { Box(Modifier.height(28.dp)) }
}

/** Row [index] of [count]: the card's fill and corners, a hairline above every row but the first. */
@Composable
fun FormRow(
    index: Int,
    count: Int,
    onClick: (() -> Unit)? = null,
    content: @Composable RowScope.() -> Unit,
) {
    GroupedCardRow(index, count, onClick, separatorInset = Form.separatorInset) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = Form.rowHeight).padding(horizontal = Form.separatorInset, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            content = content,
        )
    }
}

/** A title and, on the right in grey, its value: `LabeledContent`. */
@Composable
fun FormValueRow(index: Int, count: Int, title: String, value: String, onClick: (() -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    FormRow(index, count, onClick) {
        Text(title, style = IosText.body, modifier = Modifier.weight(1f))
        if (value.isNotEmpty()) {
            Text(value, style = IosText.body, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, textAlign = TextAlign.End)
        }
        trailing?.invoke()
    }
}

/** A title and a switch: `Toggle`. The switch alone flips it, with the system's tick. */
@Composable
fun FormToggle(index: Int, count: Int, title: String, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    FormRow(index, count) {
        Text(
            title,
            style = IosText.body,
            color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        IosSwitch(checked, enabled, onChange)
    }
}

/**
 * A title and its choice in grey with a small up-and-down chevron; a tap opens the choices in a
 * menu beside it, the chosen one ticked: a menu-style `Picker`.
 */
@Composable
fun <T> FormMenuRow(
    index: Int,
    count: Int,
    title: String,
    options: List<T>,
    selected: T,
    label: @Composable (T) -> String,
    onSelect: (T) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    FormRow(index, count, onClick = { open = true }) {
        Text(title, style = IosText.body, modifier = Modifier.weight(1f))
        Box {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(label(selected), style = IosText.body, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                Icon(
                    painterResource(R.drawable.ic_unfold_more),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(label(option), style = IosText.body) },
                        leadingIcon = {
                            Box(Modifier.width(20.dp)) {
                                if (option == selected) Icon(painterResource(R.drawable.ic_check), contentDescription = null, modifier = Modifier.size(18.dp))
                            }
                        },
                        onClick = {
                            open = false
                            onSelect(option)
                        },
                    )
                }
            }
        }
    }
}

/** A title, its value, and a minus-and-plus capsule: `Stepper` around `LabeledContent`. */
@Composable
fun FormStepperRow(
    index: Int,
    count: Int,
    title: String,
    value: String,
    canDecrease: Boolean,
    canIncrease: Boolean,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
    decreaseLabel: String,
    increaseLabel: String,
) {
    FormRow(index, count) {
        Text(title, style = IosText.body)
        Text(
            value,
            style = IosText.body,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1f),
        )
        StepperCapsule(canDecrease, canIncrease, onDecrease, onIncrease, decreaseLabel, increaseLabel)
    }
}

@Composable
private fun StepperCapsule(
    canDecrease: Boolean,
    canIncrease: Boolean,
    onDecrease: () -> Unit,
    onIncrease: () -> Unit,
    decreaseLabel: String,
    increaseLabel: String,
) {
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val track = Color(0xFF767680).copy(alpha = if (dark) 0.24f else 0.12f)
    Row(Modifier.height(32.dp).background(track, CircleShape), verticalAlignment = Alignment.CenterVertically) {
        StepperHalf(R.drawable.ic_remove, decreaseLabel, canDecrease, onDecrease)
        Box(Modifier.width(1.dp).height(18.dp).background(MaterialTheme.colorScheme.outlineVariant))
        StepperHalf(R.drawable.ic_add, increaseLabel, canIncrease, onIncrease)
    }
}

@Composable
private fun StepperHalf(icon: Int, label: String, enabled: Boolean, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    Box(
        Modifier
            .width(46.dp)
            .height(32.dp)
            .clip(CircleShape)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = label) {
                haptics.perform(Haptic.PickerStep)
                onClick()
            }
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painterResource(icon),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else 0.3f),
            modifier = Modifier.size(18.dp),
        )
    }
}

/** A row that is a text field, its placeholder in grey, with an optional control after it. */
@Composable
fun FormTextField(
    index: Int,
    count: Int,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onDone: () -> Unit,
    secure: Boolean = false,
    trailing: (@Composable () -> Unit)? = null,
) {
    FormRow(index, count) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = IosText.body.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            visualTransformation = if (secure) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = if (secure) KeyboardType.Password else KeyboardType.Text,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { onDone() }),
            modifier = Modifier.weight(1f).semantics { contentDescription = placeholder },
            decorationBox = { field ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty()) Text(placeholder, style = IosText.body, color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f), maxLines = 1)
                    field()
                }
            },
        )
        trailing?.invoke()
    }
}

/** A row that is one action: ink text, or red for one that destroys. */
@Composable
fun FormButtonRow(index: Int, count: Int, title: String, onClick: () -> Unit, enabled: Boolean = true, destructive: Boolean = false, leading: (@Composable () -> Unit)? = null) {
    val color = when {
        !enabled -> MaterialTheme.colorScheme.onSurfaceVariant
        destructive -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.primary
    }
    FormRow(index, count, onClick = if (enabled) onClick else null) {
        leading?.invoke()
        Text(title, style = IosText.body, color = color, modifier = Modifier.weight(1f))
    }
}
