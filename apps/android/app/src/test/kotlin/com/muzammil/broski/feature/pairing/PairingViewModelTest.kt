package com.muzammil.broski.feature.pairing

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import com.muzammil.broski.core.PhoneSession
import com.muzammil.broski.core.vault.AesGcmCipher
import com.muzammil.broski.core.vault.Vault
import java.io.File
import java.util.concurrent.Executors
import javax.crypto.KeyGenerator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import uniffi.broski_core.ClientException
import uniffi.broski_core.LinkFailure
import uniffi.broski_core.Phone
import uniffi.broski_core.PhoneConfig
import uniffi.broski_core.Platform
import uniffi.broski_core.newIdentitySecret

/**
 * The pairing flow over the real core (the host build of libbroski_core) and a real vault, with the
 * facade's fixture offer: a daemon-written QR for "Studio Mac" whose one route refuses connections.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PairingViewModelTest {
    @get:Rule
    val folder = TemporaryFolder()

    private val main = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val offer = File(requireNotNull(System.getProperty("broski.fixtures")), "offer.txt").readText()
    private lateinit var vault: Vault

    @Before
    fun setUp() = Dispatchers.setMain(main)

    @After
    fun tearDown() {
        scope.cancel()
        Dispatchers.resetMain()
        main.close()
    }

    private fun session(): PhoneSession {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val store = PreferenceDataStoreFactory.create(scope = scope, produceFile = { File(folder.root, "vault.preferences_pb") })
        vault = Vault(store, AesGcmCipher { key })
        val config = PhoneConfig("Test Pixel", Platform.ANDROID, "Broski tests", "0.0.0")
        return PhoneSession(Phone(newIdentitySecret(), config), vault, scope, emptyList(), emptySet())
    }

    @Test
    fun aScannedOfferIsPreviewedWithItsMachineName() {
        val pairing = PairingViewModel(session())
        pairing.scanned(offer)
        assertEquals(
            PairingState.Preview(uniffi.broski_core.parsePairingOffer(offer), alreadyPaired = false),
            pairing.state.value,
        )
        assertEquals("Studio Mac", (pairing.state.value as PairingState.Preview).offer.name)
    }

    @Test
    fun anOfferPastItsExpiryIsNotPreviewed() {
        val expiresAt = uniffi.broski_core.parsePairingOffer(offer).expiresAt.toLong()
        val pairing = PairingViewModel(session(), clock = { expiresAt * 1000 })
        pairing.scanned(offer)
        assertEquals(PairingState.Failed(PairingFailure.Expired), pairing.state.value)
    }

    @Test
    fun anythingButAPairingLinkSaysSo() {
        val pairing = PairingViewModel(session())
        pairing.scanned("https://example.com/not-a-pairing")
        val failed = pairing.state.value
        assertTrue("$failed", failed is PairingState.Failed && failed.failure == PairingFailure.WrongCode)
        pairing.pasted("   ")
        assertEquals(PairingState.Failed(PairingFailure.EmptyClipboard), pairing.state.value)
        pairing.pasted("\n$offer\n")
        assertTrue(pairing.state.value is PairingState.Preview)
    }

    @Test
    fun anUnreachableMachineFailsStoresNothingAndTheSameLinkCanBeTriedAgain() = runBlocking {
        val pairing = PairingViewModel(session())
        pairing.scanned(offer)
        pairing.pair()
        val failed = withTimeout(30_000) { pairing.state.first { it is PairingState.Failed } } as PairingState.Failed
        assertEquals(PairingFailure.Unreachable, failed.failure)
        assertTrue(vault.records().readable.isEmpty())
        pairing.retry()
        assertTrue(pairing.state.value is PairingState.Preview)
    }

    @Test
    fun everyLinkFailureHasItsSentence() {
        val expected = mapOf(
            LinkFailure.OFFER to PairingFailure.WrongCode,
            LinkFailure.OFFER_EXPIRED to PairingFailure.Expired,
            LinkFailure.MACHINE_UNREACHABLE to PairingFailure.Unreachable,
            LinkFailure.FINGERPRINT_MISMATCH to PairingFailure.FingerprintMismatch,
            LinkFailure.PAIRING_REJECTED to PairingFailure.Rejected,
            LinkFailure.PAIRING_TIMEOUT to PairingFailure.Timeout,
            LinkFailure.IDENTITY to PairingFailure.OnThisPhone,
            LinkFailure.RECORD to PairingFailure.OnThisPhone,
            LinkFailure.PUSH to PairingFailure.OnThisPhone,
            LinkFailure.RANDOMNESS to PairingFailure.OnThisPhone,
            LinkFailure.RUNTIME to PairingFailure.OnThisPhone,
        )
        assertEquals(LinkFailure.entries.toSet(), expected.keys)
        expected.forEach { (link, failure) ->
            assertEquals(link.name, failure, pairingFailure(ClientException.Link(link, "detail")))
        }
        assertEquals(PairingFailure.Timeout, pairingFailure(ClientException.Timeout()))
        assertEquals("detail", failureDetail(ClientException.Link(LinkFailure.OFFER, "detail")))
    }
}
