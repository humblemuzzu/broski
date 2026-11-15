package com.muzammil.broski.core.platform

import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Test

class LanRoutesTest {
    @Test
    fun ipv4ComesFirstIpv6IsBracketedAndLinkLocalIpv6IsLeftOut() {
        val addresses = listOf("fe80::1c2b:3a", "fd12:3456::5", "192.168.1.20", "10.0.0.7", "192.168.1.20")
            .map(InetAddress::getByName)
        assertEquals(
            listOf("192.168.1.20:41999", "10.0.0.7:41999", "[fd12:3456:0:0:0:0:0:5]:41999"),
            lanRoutes(addresses, 41999),
        )
    }
}
