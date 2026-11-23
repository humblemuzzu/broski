package com.muzammil.broski.core.platform

import java.net.Inet6Address
import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Test

class LanRoutesTest {
    @Test
    fun ipv4ComesFirstIpv6IsBracketedAndUnscopedLinkLocalIpv6IsLeftOut() {
        val addresses = listOf("fe80::1c2b:3a", "fd12:3456::5", "192.168.1.20", "10.0.0.7", "192.168.1.20")
            .map(InetAddress::getByName)
        assertEquals(
            listOf("192.168.1.20:41999", "10.0.0.7:41999", "[fd12:3456:0:0:0:0:0:5]:41999"),
            lanRoutes(addresses, 41999),
        )
    }

    @Test
    fun clat46AndLinkLocalIpv4AreFilteredWhileHotspotIpv6AndScopedLinkLocalPass() {
        val scopedLinkLocal = Inet6Address.getByAddress(
            null,
            InetAddress.getByName("fe80::c5a:4234:ce1d:55c1").address,
            14,
        )
        val addresses = listOf(
            InetAddress.getByName("192.0.0.2"),
            InetAddress.getByName("169.254.10.20"),
            InetAddress.getByName("2409:40c1:102d:a1ed::1"),
            scopedLinkLocal,
        )
        assertEquals(
            listOf(
                "[2409:40c1:102d:a1ed:0:0:0:1]:18275",
                "[fe80:0:0:0:c5a:4234:ce1d:55c1%14]:18275",
            ),
            lanRoutes(addresses, 18275),
        )
    }
}
