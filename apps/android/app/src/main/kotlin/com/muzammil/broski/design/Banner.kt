package com.muzammil.broski.design

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.muzammil.broski.R

enum class BannerStyle(@param:DrawableRes val icon: Int) {
    Info(R.drawable.ic_info),
    Warning(R.drawable.ic_warning),
    Error(R.drawable.ic_error),
}

/**
 * An inline notice in content, as iOS's `Banner`: a symbol in the style's colour, the sentence, a
 * quieter code under it if any, and at most one action, on a 10% wash of the colour.
 */
@Composable
fun Banner(style: BannerStyle, message: String, modifier: Modifier = Modifier, detail: String? = null, action: (@Composable () -> Unit)? = null) {
    val tint = style.tint()
    Row(
        modifier
            .fillMaxWidth()
            .background(tint.copy(alpha = 0.1f), RoundedCornerShape(20.dp))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(painterResource(style.icon), contentDescription = null, tint = tint, modifier = Modifier.padding(top = 1.dp).size(18.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(message, style = TextStyle(fontSize = 15.sp, lineHeight = 20.sp), color = MaterialTheme.colorScheme.onSurface)
            detail?.let {
                SelectionContainer {
                    Text(it, style = MaterialTheme.typography.bodySmall.mono(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            action?.invoke()
        }
    }
}

@Composable
private fun BannerStyle.tint(): Color = when (this) {
    BannerStyle.Info -> MaterialTheme.colorScheme.primary
    BannerStyle.Warning -> BroskiTheme.semantic.caution
    BannerStyle.Error -> MaterialTheme.colorScheme.error
}
