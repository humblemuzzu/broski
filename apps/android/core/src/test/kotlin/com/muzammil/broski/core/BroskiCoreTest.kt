package com.muzammil.broski.core

import java.io.File
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.BackendId
import uniffi.broski_contract.ClientInfo
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.HelloRequest
import uniffi.broski_contract.ProtocolVersion
import uniffi.broski_contract.SessionRef
import uniffi.broski_core.ClientException
import uniffi.broski_core.ContractState
import uniffi.broski_core.LinkFailure
import uniffi.broski_core.LinkState
import uniffi.broski_core.Machine
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.MachineStatus
import uniffi.broski_core.Phone
import uniffi.broski_core.PhoneConfig
import uniffi.broski_core.Platform
import uniffi.broski_core.PushDecision
import uniffi.broski_core.SeenMarker
import uniffi.broski_core.SeenState
import uniffi.broski_core.SessionUpdate
import uniffi.broski_core.ViewEnd
import uniffi.broski_core.WaitReason
import uniffi.broski_core.decisionLetter
import uniffi.broski_core.newIdentitySecret
import uniffi.broski_core.openNotification
import uniffi.broski_core.parsePairingOffer

/**
 * Kotlin calling the real Rust core through the generated bindings and JNA, on the JVM with the
 * host build of libbroski_core, with no machine to talk to, over the fixtures
 * `packages/link/mobile/tests/facade.rs` describes: a daemon-written QR offer, the stored record
 * and device secret of that pairing (whose one route, 127.0.0.1:9, refuses connections), and the
 * push vectors `push.md` pins.
 */
class BroskiCoreTest {
    private val fixtures = File(
        requireNotNull(System.getProperty("broski.fixtures")) { "core/build.gradle.kts sets broski.fixtures" },
    )
    private val config = PhoneConfig(
        deviceName = "Test Pixel",
        platform = Platform.ANDROID,
        clientName = "BroskiCore tests",
        clientVersion = "0.0.0",
    )
    private val session = SessionRef(backend = BackendId.PI, sessionId = "s-1")

    private fun fixture(name: String) = File(fixtures, name).readBytes()

    private fun text(name: String) = File(fixtures, name).readText()

    /** The phone of the fixtures' pairing, and its machine started from the stored record. */
    private fun storedMachine(): Pair<Phone, Machine> {
        val phone = Phone(fixture("device-secret.bin"), config)
        return phone to phone.start(MachineRecord.fromBytes(fixture("record.json")))
    }

    private suspend fun eventsUntil(machine: Machine, done: (MachineStatus) -> Boolean) {
        while (!done(machine.status())) {
            machine.nextEvent() ?: throw AssertionError("the machine ended at ${machine.status()}")
        }
    }

    @Test
    fun aNewSecretMakesAPhoneAndABrokenOneIsRefused() {
        val secret = newIdentitySecret()
        val phone = Phone(secret, config)
        assertEquals(32, phone.deviceId().length)
        assertEquals(phone.deviceId(), Phone(secret, config).deviceId())
        val broken = runCatching { Phone(secret.copyOfRange(1, secret.size), config) }.exceptionOrNull()
        assertTrue("$broken", broken is ClientException.Link && broken.failure == LinkFailure.IDENTITY)
    }

    @Test
    fun theOfferNamesTheMachineTheStoredRecordWasPairedWith() {
        val offer = parsePairingOffer(text("offer.txt"))
        val record = MachineRecord.fromBytes(fixture("record.json"))
        assertEquals(record.id(), offer.machineId)
        assertEquals("Studio Mac", offer.name)
        assertEquals(4_102_444_800uL, offer.expiresAt)
        assertEquals("macos", record.os())
        assertArrayEquals(fixture("record.json"), record.toBytes())
    }

    @Test
    fun aPairingWithAnUnreachableMachineSaysWhy() = runBlocking {
        val phone = Phone(fixture("device-secret.bin"), config)
        val failed = runCatching { phone.pair(text("offer.txt")) }.exceptionOrNull()
        assertTrue(
            "$failed",
            failed is ClientException.Link && failed.failure == LinkFailure.MACHINE_UNREACHABLE,
        )
    }

    @Test
    fun aStoredMachineRetriesItsDialHoldsItsViewAndEndsWhenForgotten() = runBlocking {
        withTimeout(30_000) {
            val (phone, machine) = storedMachine()
            assertEquals(listOf(machine.id()), phone.allMachines().map { it.id() })
            eventsUntil(machine) { it.link.state == LinkState.Waiting(WaitReason.RETRY) }
            assertEquals(ContractState.Waiting, machine.status().contract)

            val view = machine.attach(session)
            assertEquals(session, view.session())
            assertNull(view.snapshot())
            val hello = ClientMessage.Hello(
                HelloRequest(
                    requestId = "",
                    protocol = ProtocolVersion(major = 1, minor = 0),
                    client = ClientInfo(name = "broski-android", version = "1.0.0"),
                ),
            )
            val refused = runCatching { machine.request(hello) }.exceptionOrNull()
            assertTrue("$refused", refused is ClientException.InvalidRequest)

            phone.forget(machine.id())
            assertNull(phone.machine(machine.id()))
            while (machine.nextEvent() != null) continue
            assertEquals(LinkState.Closed, machine.status().link.state)
            assertEquals(SessionUpdate.Ended(ViewEnd.Closed), view.nextUpdate())
            assertNull(view.nextUpdate())
        }
    }

    /**
     * Cancelling a coroutine cancels its Rust call (`suspendCancellableCoroutine`, then the future
     * is freed), and an update is only taken in the poll that returns it, so the next pull gets it.
     */
    @Test
    fun aCancelledPullEndsAtOnceAndTheNextPullGetsWhatCameAfter() = runBlocking {
        val (phone, machine) = storedMachine()
        val view = machine.attach(session)
        val pull = launch { view.nextUpdate() }
        delay(200)
        pull.cancel()
        withTimeout(5_000) { pull.join() }
        assertTrue(pull.isCancelled)

        phone.forget(machine.id())
        assertEquals(SessionUpdate.Ended(ViewEnd.Closed), withTimeout(10_000) { view.nextUpdate() })
        assertNull(view.nextUpdate())
    }

    @Test
    fun detachingAViewEndsThePullInProgress() = runBlocking {
        val (_, machine) = storedMachine()
        val view = machine.attach(session)
        val pull = async { view.nextUpdate() }
        delay(200)
        view.detach()
        assertNull(withTimeout(5_000) { pull.await() })
        assertNull(view.session())
    }

    @Test
    fun whatWasSeenGoesBackInAsTheAppStoredIt() {
        val inbox = Phone(newIdentitySecret(), config).inbox()
        assertTrue(inbox.rows().isEmpty())
        val machineId = "00112233445566778899aabbccddeeff"
        val stored = SeenState(
            markers = listOf(
                SeenMarker(
                    machineId = machineId,
                    session = SessionRef(backend = BackendId.CLAUDE_CODE, sessionId = "s-9"),
                    seenAt = 1_725_000_000_000,
                ),
            ),
            readMachines = listOf(machineId, "ffeeddccbbaa99887766554433221100"),
        )
        inbox.restoreSeen(stored)
        assertEquals(stored, inbox.seen())
    }

    @Test
    fun thePinnedPushOpensAndADecisionSealsForTheRelay() {
        val record = MachineRecord.fromBytes(fixture("push-record.json"))
        val push = openNotification(record, text("push.txt"))
        assertEquals("approval", push.kind)
        assertEquals("Approve Bash", push.title)
        assertEquals("req-1", push.request)
        val unreadable = runCatching { openNotification(record, "AAAA") }.exceptionOrNull()
        assertTrue("$unreadable", unreadable is ClientException.Link && unreadable.failure == LinkFailure.PUSH)

        val letter = decisionLetter(record, PushDecision.DENY, "pi", "s-2", null)
        assertEquals("https://relay.example/v1/letters", letter.url)
        val headers = letter.headers.associate { it.name to it.value }
        assertEquals("00112233445566778899aabbccddeeff", headers["x-broski-machine"])
        assertEquals("Bearer token", headers["authorization"])
        assertTrue(letter.body.size > 12 + 16)
    }
}
