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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.Phone
import uniffi.broski_core.PhoneConfig
import uniffi.broski_core.Platform

/** [PhoneSession] over the real core and a real vault, with the facade's fixture machine (its one route refuses connections). */
class PhoneSessionTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val fixtures = File(requireNotNull(System.getProperty("broski.fixtures")))

    @After
    fun tearDown() = scope.cancel()

    @Test
    fun aHandleOnAForgottenMachineStaysUsable() = runBlocking {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val vault = Vault(
            PreferenceDataStoreFactory.create(scope = scope, produceFile = { File(folder.root, "vault.preferences_pb") }),
            AesGcmCipher { key },
        )
        val phone = Phone(
            File(fixtures, "device-secret.bin").readBytes(),
            PhoneConfig("Test Pixel", Platform.ANDROID, "Broski tests", "0.0.0"),
        )
        val record = File(fixtures, "record.json").readBytes()
        val machine = MachineRecord.fromBytes(record).use(phone::start)
        val id = machine.id()
        vault.saveRecord(id, record)
        val session = PhoneSession(phone, vault, scope, listOf(machine), emptySet())

        session.forget(id)

        assertNull(session.machine(id))
        assertTrue(session.machines.value.isEmpty())
        assertTrue(vault.records().readable.isEmpty())
        assertEquals(id, machine.id())
        assertEquals(id, machine.record().use { it.id() })
    }
}
