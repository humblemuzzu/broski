import 'package:xterm/xterm.dart';

/// Minimal key → escape sequence mapping for common terminal controls.
///
/// Prefer using `Terminal.keyInput(...)` + `Terminal.onOutput` for correctness.
/// This helper exists for cases where you need explicit sequences (e.g. tests,
/// non-xterm input sources).
class TerminalInputProcessor {
  static String? toSequence(
    TerminalKey key, {
    bool shift = false,
    bool alt = false,
    bool ctrl = false,
  }) {
    if (ctrl) {
      final ctrlSeq = _ctrlLetter(key);
      if (ctrlSeq != null) return ctrlSeq;
    }

    switch (key) {
      case TerminalKey.enter:
        return '\r';
      case TerminalKey.tab:
        return '\t';
      case TerminalKey.backspace:
        return '\x7f';
      case TerminalKey.escape:
        return '\x1b';
      case TerminalKey.arrowUp:
        return '\x1b[A';
      case TerminalKey.arrowDown:
        return '\x1b[B';
      case TerminalKey.arrowRight:
        return '\x1b[C';
      case TerminalKey.arrowLeft:
        return '\x1b[D';
      case TerminalKey.home:
        return '\x1b[H';
      case TerminalKey.end:
        return '\x1b[F';
      case TerminalKey.pageUp:
        return '\x1b[5~';
      case TerminalKey.pageDown:
        return '\x1b[6~';
      case TerminalKey.insert:
        return '\x1b[2~';
      case TerminalKey.delete:
        return '\x1b[3~';
      default:
        return null;
    }
  }

  static String? _ctrlLetter(TerminalKey key) {
    // Ctrl+A..Ctrl+Z → ASCII 0x01..0x1A
    final index = _letterIndex(key);
    if (index == null) return null;
    final codeUnit = 1 + index;
    return String.fromCharCode(codeUnit);
  }

  static int? _letterIndex(TerminalKey key) {
    switch (key) {
      case TerminalKey.keyA:
        return 0;
      case TerminalKey.keyB:
        return 1;
      case TerminalKey.keyC:
        return 2;
      case TerminalKey.keyD:
        return 3;
      case TerminalKey.keyE:
        return 4;
      case TerminalKey.keyF:
        return 5;
      case TerminalKey.keyG:
        return 6;
      case TerminalKey.keyH:
        return 7;
      case TerminalKey.keyI:
        return 8;
      case TerminalKey.keyJ:
        return 9;
      case TerminalKey.keyK:
        return 10;
      case TerminalKey.keyL:
        return 11;
      case TerminalKey.keyM:
        return 12;
      case TerminalKey.keyN:
        return 13;
      case TerminalKey.keyO:
        return 14;
      case TerminalKey.keyP:
        return 15;
      case TerminalKey.keyQ:
        return 16;
      case TerminalKey.keyR:
        return 17;
      case TerminalKey.keyS:
        return 18;
      case TerminalKey.keyT:
        return 19;
      case TerminalKey.keyU:
        return 20;
      case TerminalKey.keyV:
        return 21;
      case TerminalKey.keyW:
        return 22;
      case TerminalKey.keyX:
        return 23;
      case TerminalKey.keyY:
        return 24;
      case TerminalKey.keyZ:
        return 25;
      default:
        return null;
    }
  }
}
