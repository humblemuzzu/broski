package com.muzammil.broski.design

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign

private val Height = ButtonDefaults.MediumContainerHeight

/** The one primary action of a screen: a medium expressive button whose corners morph on press. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    enabled: Boolean = true,
) {
    Button(
        onClick = onClick,
        shapes = ButtonDefaults.shapesFor(Height),
        modifier = modifier.fillMaxWidth().heightIn(min = Height),
        enabled = enabled,
        contentPadding = ButtonDefaults.contentPaddingFor(Height, hasStartIcon = icon != null),
    ) { ButtonContent(text, icon) }
}

@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    enabled: Boolean = true,
) {
    FilledTonalButton(
        onClick = onClick,
        shapes = ButtonDefaults.shapesFor(Height),
        modifier = modifier.fillMaxWidth().heightIn(min = Height),
        enabled = enabled,
        contentPadding = ButtonDefaults.contentPaddingFor(Height, hasStartIcon = icon != null),
    ) { ButtonContent(text, icon) }
}

@Composable
fun QuietButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    TextButton(onClick = onClick, shapes = ButtonDefaults.shapes(), modifier = modifier.heightIn(min = ButtonDefaults.MinHeight)) {
        Text(text, style = ButtonDefaults.textStyleFor(ButtonDefaults.MinHeight), textAlign = TextAlign.Center)
    }
}

@Composable
private fun ButtonContent(text: String, @DrawableRes icon: Int?) {
    if (icon != null) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(ButtonDefaults.iconSizeFor(Height)))
        Spacer(Modifier.width(ButtonDefaults.iconSpacingFor(Height)))
    }
    Text(text, style = ButtonDefaults.textStyleFor(Height), textAlign = TextAlign.Center)
}
