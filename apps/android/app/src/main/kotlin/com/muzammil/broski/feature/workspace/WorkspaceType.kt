package com.muzammil.broski.feature.workspace

import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.muzammil.broski.design.mono

/** The iOS text styles the workspace screens draw with, at their point sizes as sp. */
object WorkspaceType {
    val body = TextStyle(fontSize = 17.sp, lineHeight = 22.sp)
    val bodyMedium = body.copy(fontWeight = FontWeight.Medium)
    val bodySemibold = body.copy(fontWeight = FontWeight.SemiBold)
    val subheadline = TextStyle(fontSize = 15.sp, lineHeight = 20.sp)
    val subheadlineSemibold = subheadline.copy(fontWeight = FontWeight.SemiBold)
    val footnote = TextStyle(fontSize = 13.sp, lineHeight = 18.sp)
    val footnoteMedium = footnote.copy(fontWeight = FontWeight.Medium)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 16.sp)
    val code = footnote.mono()
    val codeMedium = code.copy(fontWeight = FontWeight.Medium)
}
