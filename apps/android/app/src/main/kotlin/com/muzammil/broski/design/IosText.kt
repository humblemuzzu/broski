package com.muzammil.broski.design

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** iOS's text styles at the default Dynamic Type size, point for sp, so the two apps set the same type. */
object IosText {
    val title3 = TextStyle(fontSize = 20.sp, lineHeight = 25.sp)
    val body = TextStyle(fontSize = 17.sp, lineHeight = 22.sp)
    val subheadline = TextStyle(fontSize = 15.sp, lineHeight = 20.sp)
    val footnote = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)

    val tabular = TextStyle(fontFeatureSettings = "tnum")
    val figure = TextStyle(fontSize = 40.sp, lineHeight = 48.sp, fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum")
}
