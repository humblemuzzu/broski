import 'dart:convert';

import 'package:broski/agent/client/contract_frame.dart';

/// The contract frame in [text], read as [readFrame] reads one already
/// decoded. A frame that is not JSON, not an object, or not a contract frame
/// after all (a later `type` key wins in JSON) is an [UnreadableContract], like
/// any other that does not decode: this never throws for what the bridge sent.
///
/// It runs on whichever isolate reads the frame, which is why it takes and
/// returns plain values.
InboundFrame readFrameText(String text) {
  final Object? decoded;
  try {
    decoded = jsonDecode(text);
  } on FormatException catch (error) {
    return UnreadableContract(
      problem: 'a contract frame is not JSON: ${error.message}',
    );
  }
  if (decoded is! Map<String, Object?>) {
    return const UnreadableContract(problem: 'a contract frame is an object');
  }
  return readFrame(decoded) ??
      const UnreadableContract(problem: 'not a contract frame after all');
}
