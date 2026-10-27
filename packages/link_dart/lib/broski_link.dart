import 'dart:ffi';
import 'dart:typed_data';

import 'package:broski_link/src/bindings.dart';
import 'package:ffi/ffi.dart';

export 'src/bindings.dart'
    show identitySecretLength, publicBundleLength, sha256DigestLength;
export 'src/client.dart';
export 'src/connection/bridge_link_status.dart';
export 'src/connection/link_close_code.dart';
export 'src/connection/link_connection.dart';
export 'src/connection/link_outbound_queue.dart' show linkOutboundQueueMax;
export 'src/connection/link_send_failure.dart';
export 'src/connection/link_session.dart';
export 'src/connection/link_status.dart';
export 'src/connection/machine_endpoint.dart' show MachineEndpoint;
export 'src/errors.dart';
export 'src/events.dart';
export 'src/identity.dart';
export 'src/pairing.dart';

/// The ABI version of the native Broski Link library.
int abiVersion() => blAbiVersion();

/// The SHA-256 digest of [data].
Uint8List sha256(Uint8List data) {
  // malloc(0) may return null, which the native side rejects.
  final input = malloc.allocate<Uint8>(data.isEmpty ? 1 : data.length);
  final digest = malloc.allocate<Uint8>(sha256DigestLength);
  try {
    input.asTypedList(data.length).setAll(0, data);
    final status = blSha256(input, data.length, digest);
    if (status != 0) {
      throw StateError('bl_sha256 failed with status $status');
    }
    return Uint8List.fromList(digest.asTypedList(sha256DigestLength));
  } finally {
    malloc
      ..free(input)
      ..free(digest);
  }
}
