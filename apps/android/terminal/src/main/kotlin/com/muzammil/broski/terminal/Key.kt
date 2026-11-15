package com.muzammil.broski.terminal

/** The keys a phone sends, by their `GhosttyKey` value (key/event.h of libghostty-vt 1.0.1). */
enum class Key(internal val code: Int) {
    A(20), B(21), C(22), D(23), E(24), F(25), G(26), H(27), I(28), J(29), K(30), L(31), M(32),
    N(33), O(34), P(35), Q(36), R(37), S(38), T(39), U(40), V(41), W(42), X(43), Y(44), Z(45),
    Digit0(6), Digit1(7), Digit2(8), Digit3(9), Digit4(10), Digit5(11), Digit6(12), Digit7(13), Digit8(14), Digit9(15),
    Backquote(1), Backslash(2), BracketLeft(3), BracketRight(4), Comma(5), Equal(16), Minus(46), Period(47),
    Quote(48), Semicolon(49), Slash(50),
    Backspace(53), Enter(58), Space(63), Tab(64),
    Delete(68), End(69), Home(71), Insert(72), PageDown(73), PageUp(74),
    ArrowDown(75), ArrowLeft(76), ArrowRight(77), ArrowUp(78),
    Escape(120),
    F1(121), F2(122), F3(123), F4(124), F5(125), F6(126), F7(127), F8(128), F9(129), F10(130), F11(131), F12(132),
    ;

    companion object {
        private val letters = listOf(A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z)
        private val digits = listOf(Digit0, Digit1, Digit2, Digit3, Digit4, Digit5, Digit6, Digit7, Digit8, Digit9)
        private val punctuation = mapOf(
            '`' to Backquote, '\\' to Backslash, '[' to BracketLeft, ']' to BracketRight, ',' to Comma,
            '=' to Equal, '-' to Minus, '.' to Period, '\'' to Quote, ';' to Semicolon, '/' to Slash, ' ' to Space,
        )

        /** The US-layout key that types `char` unshifted, for Ctrl and Alt chords typed on a soft keyboard. */
        fun of(char: Char): Key? = when (char) {
            in 'a'..'z' -> letters[char - 'a']
            in 'A'..'Z' -> letters[char - 'A']
            in '0'..'9' -> digits[char - '0']
            else -> punctuation[char]
        }
    }
}

/** `GhosttyMods` bits. */
object Mods {
    const val NONE = 0
    const val SHIFT = 1
    const val CTRL = 1 shl 1
    const val ALT = 1 shl 2
    const val SUPER = 1 shl 3
}
