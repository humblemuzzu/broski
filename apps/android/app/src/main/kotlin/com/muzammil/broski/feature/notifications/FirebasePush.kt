package com.muzammil.broski.feature.notifications

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.muzammil.broski.BuildConfig
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Firebase, set up from the build's own fields rather than a google-services.json, so a build
 * without a Firebase project still builds and runs, only without push (apps/android/README.md).
 */
object FirebasePush {
    private const val TAG = "FirebasePush"

    /** Starts Firebase once; false, with the reason logged, when this build carries no Firebase project. */
    fun start(context: Context): Boolean {
        if (FirebaseApp.getApps(context).isNotEmpty()) return true
        if (BuildConfig.FIREBASE_APP_ID.isEmpty() || BuildConfig.FIREBASE_API_KEY.isEmpty() || BuildConfig.FIREBASE_PROJECT_ID.isEmpty()) {
            Log.i(TAG, "no Firebase project in this build (broski.firebase.* unset): push is off")
            return false
        }
        val options = FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.FIREBASE_APP_ID)
            .setApiKey(BuildConfig.FIREBASE_API_KEY)
            .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
            .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
            .build()
        FirebaseApp.initializeApp(context, options)
        return true
    }

    /** This install's FCM token, or null when Firebase could not give one (no Play services, no network). */
    suspend fun token(): String? = suspendCancellableCoroutine { continuation ->
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) Log.w(TAG, "no FCM token", task.exception)
            continuation.resume(if (task.isSuccessful) task.result else null)
        }
    }
}
