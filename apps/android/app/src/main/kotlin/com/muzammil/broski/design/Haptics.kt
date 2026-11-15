package com.muzammil.broski.design

import androidx.compose.ui.hapticfeedback.HapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType

/** design.md's haptic moments; the platform skips them when touch feedback is off. */
enum class Haptic(internal val type: HapticFeedbackType) {
    Success(HapticFeedbackType.Confirm),
    Warning(HapticFeedbackType.Reject),
    Failure(HapticFeedbackType.Reject),
    Expand(HapticFeedbackType.ToggleOn),
    Collapse(HapticFeedbackType.ToggleOff),
    Send(HapticFeedbackType.Confirm),
    Stop(HapticFeedbackType.GestureEnd),
    PickerStep(HapticFeedbackType.SegmentTick),
    SnapToLatest(HapticFeedbackType.GestureThresholdActivate),
}

fun HapticFeedback.perform(haptic: Haptic) = performHapticFeedback(haptic.type)
