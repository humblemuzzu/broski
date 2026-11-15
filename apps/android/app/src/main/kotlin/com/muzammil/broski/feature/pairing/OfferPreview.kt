package com.muzammil.broski.feature.pairing

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.muzammil.broski.R
import com.muzammil.broski.design.PrimaryButton
import com.muzammil.broski.design.QuietButton
import kotlinx.coroutines.delay

@Composable
internal fun OfferPreview(
    preview: PairingState.Preview,
    onPair: () -> Unit,
    onScanAnother: () -> Unit,
    onExpired: () -> Unit,
) {
    val expiresAtMs = preview.offer.expiresAt.toLong() * 1000
    val remainingMs by produceState(expiresAtMs - System.currentTimeMillis(), expiresAtMs) {
        while (value > 0) {
            delay(value % 1000 + 1)
            value = expiresAtMs - System.currentTimeMillis()
        }
        onExpired()
    }
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                stringResource(R.string.pairing_offer_from),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                preview.offer.name,
                style = MaterialTheme.typography.headlineMediumEmphasized,
                modifier = Modifier.semantics { heading() },
            )
            Fact(R.drawable.ic_schedule, stringResource(R.string.pairing_expires_in, countdown(remainingMs)))
            if (preview.alreadyPaired) {
                Fact(R.drawable.ic_check_circle, stringResource(R.string.pairing_already_paired))
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PrimaryButton(stringResource(R.string.pairing_pair_with, preview.offer.name), onPair)
        QuietButton(stringResource(R.string.pairing_scan_again), onScanAnother, Modifier.fillMaxWidth())
    }
}

@Composable
private fun Fact(@DrawableRes icon: Int, text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(
            painterResource(icon),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

/** `4:05` for minutes and seconds left, never below zero. */
internal fun countdown(remainingMs: Long): String {
    val seconds = (remainingMs.coerceAtLeast(0) + 999) / 1000
    return "${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
}
