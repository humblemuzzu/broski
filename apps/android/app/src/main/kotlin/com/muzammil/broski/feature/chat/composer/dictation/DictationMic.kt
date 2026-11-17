package com.muzammil.broski.feature.chat.composer.dictation

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import com.muzammil.broski.R
import com.muzammil.broski.core.voice.Dictation
import com.muzammil.broski.core.voice.DictationFeedback
import com.muzammil.broski.core.voice.DictationNotice
import com.muzammil.broski.core.voice.DictationPhase
import com.muzammil.broski.core.voice.DictationTarget
import com.muzammil.broski.core.voice.PressOutcome
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.perform
import kotlinx.coroutines.flow.filter

/** The app's one [Dictation], provided at the root; `null` in previews and tests. */
val LocalDictation = staticCompositionLocalOf<Dictation?> { null }

/** A composer's dictation: the app's one [Dictation], where this composer's text goes, and how to reach Voice settings. */
@Immutable
class DictationHook(val dictation: Dictation, val target: DictationTarget, val openVoiceSettings: (() -> Unit)?)

/**
 * The mic with what it needs first: the microphone permission, asked on the first press; with no xAI
 * key, the phone's own recognizer in place of the recording.
 */
@Composable
fun DictationMic(hook: DictationHook, phase: DictationPhase, busy: Boolean) {
    val context = LocalContext.current
    val dictation = hook.dictation
    val target = hook.target
    val prompt = stringResource(R.string.dictation_phone_prompt)
    val recognizer = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            dictation.recognized(target, result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull())
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) dictation.microphoneAllowed(target.id) else dictation.microphoneDenied(target.id)
    }
    val recognize = {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
        dictation.language()?.let { intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, it) }
        try {
            recognizer.launch(intent)
        } catch (_: ActivityNotFoundException) {
            dictation.noRecognizer(target.id)
        }
    }
    MicButton(
        phase = phase,
        enabled = !busy,
        onPress = {
            val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            when {
                dictation.key.value == null && phase == DictationPhase.Idle -> recognize()
                !allowed -> permission.launch(Manifest.permission.RECORD_AUDIO)
                dictation.press(target) == PressOutcome.NeedsPhoneRecognizer -> recognize()
            }
        },
        onSlide = dictation::slide,
        onRelease = dictation::release,
    )
}

/** The line a dictation left under the composer. */
@Composable
fun DictationNoticeText(notice: DictationNotice, modifier: Modifier = Modifier) {
    Text(
        stringResource(
            when (notice.kind) {
                DictationNotice.Kind.HeardNothing -> R.string.dictation_heard_nothing
                DictationNotice.Kind.TooShort -> R.string.dictation_too_short
                DictationNotice.Kind.PhoneRecognizer -> R.string.dictation_phone_recognizer
                DictationNotice.Kind.NoRecognizer -> R.string.dictation_no_recognizer
                DictationNotice.Kind.MicrophoneReady -> R.string.dictation_microphone_ready
            },
        ),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/** The haptics of [hook]'s composer's dictation, and the end of its recording when the composer goes. */
@Composable
fun DictationHaptics(hook: DictationHook) {
    val haptics = LocalHapticFeedback.current
    DisposableEffect(hook.dictation, hook.target.id) {
        onDispose { hook.dictation.composerLeft(hook.target.id) }
    }
    LaunchedEffect(hook.dictation, hook.target.id) {
        hook.dictation.feedback.filter { it.owner == hook.target.id }.collect { feedback ->
            haptics.perform(
                when (feedback.moment) {
                    DictationFeedback.Moment.Listening -> Haptic.Expand
                    DictationFeedback.Moment.Stopped -> Haptic.Stop
                    DictationFeedback.Moment.Inserted -> Haptic.Success
                    DictationFeedback.Moment.Cancelled -> Haptic.Warning
                    DictationFeedback.Moment.Failed -> Haptic.Failure
                },
            )
        }
    }
}
