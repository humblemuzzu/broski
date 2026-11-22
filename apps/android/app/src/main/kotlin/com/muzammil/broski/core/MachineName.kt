package com.muzammil.broski.core

/**
 * How a Mac's name reads on the phone. A pairing made before the daemon named Macs by their
 * Computer Name carries the network host name ("Studio-MacBook-Pro-5.local"), which reads as
 * "Studio MacBook Pro 5"; a name the person chose is shown as it is.
 */
object MachineName {
    private const val LOCAL = ".local"

    fun display(name: String): String {
        val trimmed = name.trim()
        if (!trimmed.endsWith(LOCAL, ignoreCase = true)) return trimmed
        val words = trimmed.dropLast(LOCAL.length).split('-').filter(String::isNotEmpty).joinToString(" ")
        return words.ifEmpty { trimmed }
    }
}
