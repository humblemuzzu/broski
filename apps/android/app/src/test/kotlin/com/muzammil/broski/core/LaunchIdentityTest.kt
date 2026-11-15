package com.muzammil.broski.core

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.muzammil.broski.core.vault.AesGcmCipher
import com.muzammil.broski.core.vault.Vault
import java.io.File
import javax.crypto.KeyGenerator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Which identity the phone opens with, over a real vault: made on the first run only, never over pairings. */
class LaunchIdentityTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val vault = Vault(
        PreferenceDataStoreFactory.create(scope = scope, produceFile = { File(folder.root, "vault.preferences_pb") }),
        AesGcmCipher { key },
    )

    @After
    fun tearDown() = scope.cancel()

    @Test
    fun aFirstRunMakesAnIdentityAndEveryLaunchAfterItGetsThatOne() = runBlocking {
        assertNull(vault.identity())
        val made = launchIdentity(vault)
        assertTrue(made.isNotEmpty())
        assertArrayEquals(made, vault.identity())
        assertArrayEquals(made, launchIdentity(vault))
    }

    @Test
    fun pairingsWithoutTheirIdentityAreNeverGivenANewOne() = runBlocking {
        vault.saveRecord("m-1", "a record".encodeToByteArray())

        assertThrows(MissingIdentityException::class.java) { runBlocking { launchIdentity(vault) } }

        assertNull("nothing was written over the gap", vault.identity())
        assertEquals(setOf("m-1"), vault.records().readable.keys)
    }

    @Test
    fun startingOverClearsTheVaultSoTheNextLaunchIsAFirstRun() = runBlocking {
        vault.saveRecord("m-1", "a record".encodeToByteArray())
        vault.saveIdentity(ByteArray(32) { 7 })

        vault.clear()

        assertNull(vault.identity())
        assertNull(vault.seen())
        assertEquals(emptySet<String>(), vault.records().readable.keys)
        assertNotNull(launchIdentity(vault))
    }
}
