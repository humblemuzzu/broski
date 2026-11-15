package com.muzammil.broski.design

import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.spring

/**
 * The one spring for things that appear over content (a floating bar, a toast), short and barely
 * bouncing, as other clients's mobile app moves them; screens and lists use `MaterialTheme.motionScheme`.
 */
object BroskiMotion {
    fun <T> spring(): SpringSpec<T> = spring(dampingRatio = 0.86f, stiffness = 680f)
}
