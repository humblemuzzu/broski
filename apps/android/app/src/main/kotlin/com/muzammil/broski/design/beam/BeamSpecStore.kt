package com.muzammil.broski.design.beam

import android.content.Context
import android.util.Log
import java.io.IOException
import kotlinx.serialization.SerializationException

/** The beam's spec, read once per process from the `beam-spec.json` asset; null, and no beam, if it cannot be read. */
internal object BeamSpecStore {
    private const val TAG = "BorderBeam"
    private const val ASSET = "beam-spec.json"

    private class Loaded(val spec: BeamSpec?)

    @Volatile
    private var loaded: Loaded? = null

    fun spec(context: Context): BeamSpec? {
        loaded?.let { return it.spec }
        return synchronized(this) { (loaded ?: Loaded(read(context)).also { loaded = it }).spec }
    }

    private fun read(context: Context): BeamSpec? = try {
        val json = context.applicationContext.assets.open(ASSET).use { it.readBytes().decodeToString() }
        BeamSpec.parse(json)
    } catch (error: IOException) {
        Log.w(TAG, "could not read $ASSET", error)
        null
    } catch (error: SerializationException) {
        Log.w(TAG, "$ASSET was malformed", error)
        null
    }
}
