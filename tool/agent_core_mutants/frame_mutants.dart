import 'mutant.dart';

/// Mutants of how frames are read: where, in what order, and what a frame that
/// cannot be read becomes.
final frameMutants = [
  ...mutantsOf('client/frame_lane.dart', const [
    Mutant(
      'lane: a large frame is read on the UI isolate when nothing waits',
      'if (!_draining && _waiting.isEmpty && text.length <= offloadAbove) {',
      'if (!_draining && _waiting.isEmpty) {',
    ),
    Mutant(
      'lane: a large frame that waited is read on the UI isolate',
      'final frame = text.length <= offloadAbove\n'
          '          ? _readHere(text)\n'
          '          : await _readAway(_read, text);',
      'final frame = _readHere(text);',
    ),
    Mutant(
      'lane: a small frame passes the large one being read',
      'if (!_draining && _waiting.isEmpty && text.length',
      'if (_waiting.isEmpty && text.length',
    ),
    Mutant(
      'lane: a closed lane delivers what was being read',
      'if (!_closed) _deliver(frame);',
      '_deliver(frame);',
    ),
    Mutant(
      'lane: an isolate that fails throws at the lane',
      'on Object catch (error) {\n    return _unreadable(text, error);\n  }\n}',
      'on FormatException catch (error) {\n    return _unreadable(text, error);\n  }\n}',
    ),
    Mutant(
      'lane: a reader that fails on the UI isolate throws at the caller',
      'try {\n      return _read(text);\n    } on Object catch (error) {\n      return _unreadable(text, error);\n    }',
      'return _read(text);',
    ),
  ]),
  ...mutantsOf('client/socket_contract_link.dart', const [
    Mutant(
      'link: every text frame is taken, the old protocol\'s too',
      'if (!text.startsWith(contractFramePrefix)) return false;',
      '',
    ),
    Mutant(
      'link: the socket keeps offering frames to a client let go',
      '    _socket.frameClaim = null;\n',
      '',
    ),
    Mutant(
      'link: a contract frame in another form is dropped',
      'if (frame[\'type\'] != contractFrameType) return;\n    final requestId',
      'return;\n    final requestId',
    ),
  ]),
  ...mutantsOf('client/contract_frame.dart', const [
    Mutant(
      'frame: a contract frame with more than its two keys is read',
      'if (frame.length != 2 || message is! Map<String, Object?>) {',
      'if (message is! Map<String, Object?>) {',
    ),
    Mutant(
      'frame: an unreadable event does not name its session',
      'session: _eventSession(message),',
      '',
    ),
  ]),
  ...mutantsOf('client/contract_client.dart', const [
    Mutant('client: a link let go is not told', '    _link.close();\n', ''),
  ]),
];
