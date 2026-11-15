package com.muzammil.broski.feature.pairing

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.muzammil.broski.R
import com.muzammil.broski.design.Haptic
import com.muzammil.broski.design.PrimaryButton
import com.muzammil.broski.design.QuietButton
import com.muzammil.broski.design.SecondaryButton
import com.muzammil.broski.design.perform
import com.muzammil.broski.feature.notifications.LocalNotificationAsk
import kotlinx.coroutines.launch

/**
 * Scan or paste, preview the offer, pair, and say plainly what went wrong. `intro` is what the idle
 * state shows above the two actions: the welcome on a first run, a short line from Machines.
 */
@Composable
fun PairingFlow(
    viewModel: PairingViewModel,
    onPaired: (machineId: String) -> Unit,
    modifier: Modifier = Modifier,
    intro: @Composable ColumnScope.() -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    PairingEffects(state, viewModel, onPaired)
    val (scan, paste) = rememberPairingInputs(viewModel)
    val motion = MaterialTheme.motionScheme
    AnimatedContent(
        targetState = state,
        contentKey = { it::class },
        transitionSpec = {
            (fadeIn(motion.defaultEffectsSpec()) + slideInVertically(motion.defaultSpatialSpec()) { it / 10 }) togetherWith
                fadeOut(motion.fastEffectsSpec())
        },
        modifier = modifier,
        label = "pairing",
    ) { current ->
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            when (current) {
                PairingState.Idle, is PairingState.Paired -> {
                    intro()
                    PairingActions(onScan = scan, onPaste = paste)
                }
                is PairingState.Preview -> OfferPreview(
                    preview = current,
                    onPair = viewModel::pair,
                    onScanAnother = viewModel::reset,
                    onExpired = viewModel::expired,
                )
                is PairingState.Pairing -> PairingProgress(current.name)
                is PairingState.Failed -> PairingFailed(current, onRetry = viewModel::retry, onReset = viewModel::reset)
            }
        }
    }
}

/** Back leaves a preview or a failure for the start; it does nothing while the pairing runs. */
@Composable
private fun PairingEffects(state: PairingState, viewModel: PairingViewModel, onPaired: (String) -> Unit) {
    val haptics = LocalHapticFeedback.current
    val notificationAsk = LocalNotificationAsk.current
    BackHandler(enabled = state is PairingState.Preview || state is PairingState.Failed, onBack = viewModel::reset)
    BackHandler(enabled = state is PairingState.Pairing) {}
    LaunchedEffect(state) {
        when (state) {
            is PairingState.Paired -> {
                haptics.perform(Haptic.Success)
                notificationAsk.ask()
                viewModel.reset()
                onPaired(state.machineId)
            }
            is PairingState.Failed -> haptics.perform(Haptic.Failure)
            else -> Unit
        }
    }
}

/** Scan with Google Code Scanner, or read the clipboard once, on tap and never otherwise. */
@Composable
private fun rememberPairingInputs(viewModel: PairingViewModel): Pair<() -> Unit, () -> Unit> {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val scan: () -> Unit = {
        scope.launch {
            when (val result = scanQrCode(context)) {
                is ScanResult.Scanned -> viewModel.scanned(result.text)
                ScanResult.Cancelled -> Unit
                is ScanResult.Unavailable -> viewModel.scannerUnavailable(result.detail)
            }
        }
    }
    val paste: () -> Unit = {
        scope.launch {
            val clip = clipboard.getClipEntry()?.clipData
            val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
            viewModel.pasted(text)
        }
    }
    return scan to paste
}

@Composable
private fun PairingActions(onScan: () -> Unit, onPaste: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PrimaryButton(stringResource(R.string.pairing_scan), onScan, icon = R.drawable.ic_qr_code_scanner)
        SecondaryButton(stringResource(R.string.pairing_paste), onPaste, icon = R.drawable.ic_content_paste)
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun PairingProgress(name: String) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        LoadingIndicator(Modifier.size(96.dp))
        Text(
            stringResource(R.string.pairing_in_progress, name),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

@Composable
private fun PairingFailed(failed: PairingState.Failed, onRetry: () -> Unit, onReset: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Icon(
            painterResource(R.drawable.ic_error),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(40.dp),
        )
        Text(
            stringResource(R.string.pairing_failed_title),
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            stringResource(failed.failure.message),
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        failed.detail?.let {
            Text(
                stringResource(R.string.error_details, it),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
            if (failed.failure.retryable) {
                PrimaryButton(stringResource(R.string.pairing_try_again), onRetry)
                QuietButton(stringResource(R.string.pairing_scan_again), onReset, Modifier.fillMaxWidth())
            } else {
                PrimaryButton(stringResource(R.string.pairing_scan_again), onReset)
            }
        }
    }
}
