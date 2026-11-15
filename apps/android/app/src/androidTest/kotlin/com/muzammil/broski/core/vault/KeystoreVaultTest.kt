package com.muzammil.broski.core.vault

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

/** The vault sealed with the real Android Keystore key, on a device, in a file of its own. */
class KeystoreVaultTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val file = File(context.cacheDir, "keystore-vault-test.preferences_pb").apply { delete() }
    private val scopes = mutableListOf<CoroutineScope>()

    @After
    fun tearDown() {
        runBlocking { closeStores() }
        file.delete()
    }

    /** DataStore lets the file go only once its scope has completed, not when it is cancelled. */
    private suspend fun closeStores() {
        scopes.forEach { it.coroutineContext.job.cancelAndJoin() }
        scopes.clear()
    }

    private suspend fun vault(): Vault {
        closeStores()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO).also(scopes::add)
        val store = PreferenceDataStoreFactory.create(scope = scope, produceFile = { file })
        return Vault(store, AesGcmCipher { KeystoreKey.obtain() })
    }

    @Test
    fun theKeystoreKeyNeverLeavesTheKeystoreAndOpensWhatItSealed() = runBlocking {
        assertNull("a Keystore key exposes no key material", KeystoreKey.obtain().encoded)
        val secret = ByteArray(32) { (it * 7).toByte() }
        vault().saveIdentity(secret)
        vault().saveRecord("m-1", "record".encodeToByteArray())

        val reopened = vault()
        assertArrayEquals(secret, reopened.identity())
        assertArrayEquals("record".encodeToByteArray(), reopened.records().readable["m-1"])
        assertFalse(file.readBytes().decodeToString().contains("record"))
    }
}
