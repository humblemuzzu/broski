import 'dart:async';
import 'dart:collection';
import 'dart:isolate';

import 'package:broski/agent/client/contract_frame.dart';
import 'package:broski/agent/client/frame_text.dart';

/// The largest contract frame, in characters, read on the UI isolate. Reading
/// one (decoding the JSON and building the typed message) costs 0.2 ms at this
/// size on a desktop VM, 1.4 ms at 265,000 characters and 120 ms at 13
/// million, and a phone is several times slower; handing a frame to another
/// isolate costs this one 0.01 to 0.05 ms whatever the size. Measured by
/// `dart run tool/measure_frame_reading.dart` (app-core README §3).
const frameOffloadChars = 32 * 1024;

typedef FrameReader = InboundFrame Function(String text);

/// Reads the text frames of one connection and delivers them in the order they
/// arrived, whichever isolate read each. A frame at most [offloadAbove]
/// characters long is read at once, on the calling isolate, and delivered
/// synchronously when nothing is ahead of it; a longer one is read on another
/// isolate, and what arrives meanwhile waits behind it.
///
/// Nothing here throws at a caller: a frame that cannot be read, or an isolate
/// that fails, is delivered as an [UnreadableContract].
final class FrameLane {
  FrameLane({
    required void Function(InboundFrame frame) deliver,
    FrameReader read = readFrameText,
    this.offloadAbove = frameOffloadChars,
  }) : _deliver = deliver,
       _read = read;

  final int offloadAbove;
  final void Function(InboundFrame frame) _deliver;
  final FrameReader _read;
  final Queue<String> _waiting = Queue();
  var _draining = false;
  var _closed = false;

  void add(String text) {
    if (_closed) return;
    if (!_draining && _waiting.isEmpty && text.length <= offloadAbove) {
      _deliver(_readHere(text));
      return;
    }
    _waiting.add(text);
    if (!_draining) unawaited(_drain());
  }

  /// Drops what is waiting and delivers nothing more.
  void close() {
    _closed = true;
    _waiting.clear();
  }

  Future<void> _drain() async {
    _draining = true;
    while (_waiting.isNotEmpty && !_closed) {
      final text = _waiting.removeFirst();
      final frame = text.length <= offloadAbove
          ? _readHere(text)
          : await _readAway(_read, text);
      if (!_closed) _deliver(frame);
    }
    _draining = false;
  }

  InboundFrame _readHere(String text) {
    try {
      return _read(text);
    } on Object catch (error) {
      return _unreadable(text, error);
    }
  }
}

Future<InboundFrame> _readAway(FrameReader read, String text) async {
  try {
    return await Isolate.run(() => read(text));
  } on Object catch (error) {
    return _unreadable(text, error);
  }
}

UnreadableContract _unreadable(String text, Object error) => UnreadableContract(
  problem:
      'the app could not read a frame of ${text.length} characters: $error',
);
