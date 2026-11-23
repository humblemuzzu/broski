package com.muzammil.broski.design

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * How much room a screen leaves under its last row for the floating tab bar (and the working capsule
 * above it) that the shell draws over the content; zero where the bar is hidden.
 */
val LocalTabBarClearance = staticCompositionLocalOf<Dp> { 0.dp }
