package com.muzammil.broski.feature.pairing

import android.content.Context
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

sealed interface ScanResult {
    data class Scanned(val text: String) : ScanResult

    data object Cancelled : ScanResult

    data class Unavailable(val detail: String?) : ScanResult
}

/**
 * Google Code Scanner, QR only: Play services shows its own camera screen, so the app holds no
 * camera permission and sees only the decoded text.
 */
suspend fun scanQrCode(context: Context): ScanResult = suspendCancellableCoroutine { continuation ->
    val options = GmsBarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .enableAutoZoom()
        .build()
    GmsBarcodeScanning.getClient(context, options).startScan()
        .addOnSuccessListener { barcode -> continuation.resume(ScanResult.Scanned(barcode.rawValue.orEmpty())) }
        .addOnCanceledListener { continuation.resume(ScanResult.Cancelled) }
        .addOnFailureListener { error -> continuation.resume(ScanResult.Unavailable(error.message)) }
}
