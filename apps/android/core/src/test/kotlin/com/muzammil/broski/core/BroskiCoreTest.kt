package com.muzammil.broski.core

import java.io.File
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import uniffi.broski_contract.ClientInfo
import uniffi.broski_contract.ClientMessage
import uniffi.broski_contract.HelloRequest
import uniffi.broski_contract.ProtocolVersion
import uniffi.broski_contract.ServerMessage
import uniffi.broski_core.CoreException
import uniffi.broski_core.DeviceIdentity
import uniffi.broski_core.LinkEvent
import uniffi.broski_core.LinkRuntime
import uniffi.broski_core.LinkSession
import uniffi.broski_core.LinkState
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.PairingOffer
import uniffi.broski_core.Platform
import uniffi.broski_core.PushDecision
import uniffi.broski_core.SessionOptions
import uniffi.broski_core.WaitReason
import uniffi.broski_core.decisionLetter
import uniffi.broski_core.decodeFrame
import uniffi.broski_core.encodeFrame
import uniffi.broski_core.openNotification
import uniffi.broski_core.pair

/**
 * Kotlin calling the real Rust core through the generated bindings and JNA, on the JVM with the
 * host build of libbroski_core, over the fixtures `packages/link/mobile/tests/facade.rs` describes:
 * a daemon-written QR offer, the stored record and device secret of that pairing (whose one route,
 * 127.0.0.1:9, refuses connections), and the push vectors `push.md` pins.
 */
class BroskiCoreTest {
    private val fixtures = File(
        requireNotNull(System.getProperty("broski.fixtures")) { "core/build.gradle.kts sets broski.fixtures" },
    )
    private val options = SessionOptions(deviceName = "Test Pixel", platform = Platform.ANDROID)

    private fun fixture(name: String) = File(fixtures, name).readBytes()

    private fun text(name: String) = File(fixtures, name).readText()

    private fun identity() = DeviceIdentity.fromSecret(fixture("device-secret.bin"))

    @Test
    fun anIdentityRestoresFromItsSecretAndABrokenSecretIsRefused() {
        val identity = DeviceIdentity.generate()
        val secret = identity.secret()
        assertEquals(3617, secret.size)
        assertEquals(32, identity.id().length)
        assertEquals(identity.id(), DeviceIdentity.fromSecret(secret).id())
        assertThrows(CoreException.Identity::class.java) {
            DeviceIdentity.fromSecret(secret.copyOfRange(1, secret.size))
        }
    }

    @Test
    fun theOfferPinsTheMachineTheStoredRecordWasPairedWith() {
        val offer = PairingOffer.parse(text("offer.txt"))
        val record = MachineRecord.fromBytes(fixture("record.json"))
        assertEquals(record.id(), offer.machineId())
        assertEquals("Studio Mac", offer.name())
        assertEquals(4_102_444_800uL, offer.expiresAt())
        assertEquals("macos", record.os())
        assertArrayEquals(fixture("record.json"), record.toBytes())
    }

    @Test
    fun aPairingWithAnUnreachableMachineFailsAndSpendsTheOffer() = runBlocking {
        val runtime = LinkRuntime()
        val offer = PairingOffer.parse(text("offer.txt"))
        val first = runCatching { pair(runtime, identity(), offer, options) }.exceptionOrNull()
        assertTrue("$first", first is CoreException.MachineUnreachable)
        val again = runCatching { pair(runtime, identity(), offer, options) }.exceptionOrNull()
        assertTrue("$again", again is CoreException.OfferUsed)
    }

    @Test
    fun aStoredSessionReportsItsFailedDialThenItsClose() = runBlocking {
        val record = MachineRecord.fromBytes(fixture("record.json"))
        val session = LinkSession.start(LinkRuntime(), identity(), record, options)
        assertEquals(record.id(), session.machineId())

        withTimeout(10_000) {
            while (true) {
                val event = session.nextEvent() ?: throw AssertionError("the session ended")
                if (event is LinkEvent.Status &&
                    event.status.state == LinkState.Waiting(WaitReason.RETRY)
                ) {
                    break
                }
            }
        }

        session.end()
        var last: LinkState? = null
        while (true) {
            val event = session.nextEvent() ?: break
            if (event is LinkEvent.Status) last = event.status.state
        }
        assertEquals(LinkState.Closed, last)
        assertEquals(LinkState.Closed, session.status().state)
    }

    @Test
    fun aContractMessageCrossesTheFrameBothWays() {
        val hello = ClientMessage.Hello(
            HelloRequest(
                requestId = "r-1",
                protocol = ProtocolVersion(major = 1, minor = 0),
                client = ClientInfo(name = "broski-android", version = "1.0.0"),
            ),
        )
        val sent = encodeFrame(hello).decodeToString()
        assertTrue(sent, sent.startsWith("""{"type":"contract","message":{"type":"hello","requestId":"r-1","""))
        assertTrue(sent, sent.contains(""""client":{"name":"broski-android","version":"1.0.0"}"""))

        val reply = """{"type":"contract","message":{"type":"hello.result","requestId":"r-1","protocol":{"major":1,"minor":0},"bridgeVersion":"2.0.0"}}"""
        val result = decodeFrame(reply.encodeToByteArray()) as ServerMessage.HelloResult
        assertEquals("2.0.0", result.v1.bridgeVersion)
        assertEquals(ProtocolVersion(major = 1, minor = 0), result.v1.protocol)
        assertThrows(CoreException.Frame::class.java) {
            decodeFrame("""{"type":"contract"}""".encodeToByteArray())
        }
    }

    @Test
    fun thePinnedPushOpensAndADecisionSealsForTheRelay() {
        val record = MachineRecord.fromBytes(fixture("push-record.json"))
        val push = openNotification(record, text("push.txt"))
        assertEquals("approval", push.kind)
        assertEquals("Approve Bash", push.title)
        assertEquals("req-1", push.request)

        val letter = decisionLetter(record, PushDecision.DENY, "pi", "s-2", null)
        assertEquals("https://relay.example/v1/letters", letter.url)
        val headers = letter.headers.associate { it.name to it.value }
        assertEquals("00112233445566778899aabbccddeeff", headers["x-broski-machine"])
        assertEquals("Bearer token", headers["authorization"])
        assertTrue(letter.body.size > 12 + 16)
    }
}
