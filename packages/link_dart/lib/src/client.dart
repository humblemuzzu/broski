import 'dart:ffi';
import 'dart:typed_data';

import 'package:broski_link/src/bindings.dart';
import 'package:broski_link/src/buffer.dart';
import 'package:broski_link/src/errors.dart';
import 'package:broski_link/src/events.dart';
import 'package:broski_link/src/identity.dart';
import 'package:ffi/ffi.dart';

/// One phone-side link: identity, handshake and sealed framing in Rust.
final class LinkClient {
  LinkClient({
    required LinkIdentity identity,
    required Uint8List serverBundle,
  }) {
    if (serverBundle.length != publicBundleLength) {
      throw ArgumentError.value(
        serverBundle.length,
        'serverBundle',
        'a public bundle is $publicBundleLength bytes',
      );
    }
    final secret = copyIn(identity.secret);
    final bundle = copyIn(serverBundle);
    try {
      _handle = blClientNew(
        secret,
        identity.secret.length,
        bundle,
        serverBundle.length,
      );
      if (_handle == nullptr) {
        throw LinkProtocolException(-2, lastErrorMessage());
      }
    } finally {
      malloc
        ..free(secret)
        ..free(bundle);
    }
    _finalizer.attach(this, _handle, detach: this);
  }

  static final Finalizer<Pointer<BlClient>> _finalizer =
      Finalizer<Pointer<BlClient>>(blClientFree);

  late final Pointer<BlClient> _handle;

  /// Detaches the current connection and returns msg1 to send. A
  /// [pairingSecret] of 32 bytes selects Pair mode; null selects Connect mode.
  Uint8List connect({Uint8List? pairingSecret, required int nowMs}) {
    final secret = pairingSecret;
    if (secret != null && secret.length != 32) {
      throw ArgumentError.value(
        secret.length,
        'pairingSecret',
        'a pairing secret is 32 bytes',
      );
    }
    final input = secret == null ? nullptr : copyIn(secret);
    final output = newBuffer();
    try {
      checkStatus(blClientConnect(_handle, input, nowMs, output));
      return takeBuffer(output);
    } finally {
      if (input != nullptr) {
        malloc.free(input);
      }
      calloc.free(output);
    }
  }

  /// One whole wire message: msg2 first, then one sealed frame per message.
  void handle(Uint8List data, {required int nowMs}) {
    final input = copyIn(data);
    try {
      checkStatus(blClientHandle(_handle, input, data.length, nowMs));
    } finally {
      malloc.free(input);
    }
  }

  /// Queued while disconnected; dropped when the peer answers with a new session.
  void send(int stream, Uint8List data, {required int nowMs}) {
    final input = copyIn(data);
    try {
      checkStatus(blClientSend(_handle, stream, input, data.length, nowMs));
    } finally {
      malloc.free(input);
    }
  }

  /// The next sealed message to put on the wire, or null when there is none.
  Uint8List? pollTransmit() {
    final holder = newBuffer();
    try {
      final status = blClientPollTransmit(_handle, holder);
      if (status == 0) {
        return null;
      }
      checkStatus(status);
      return takeBuffer(holder);
    } finally {
      calloc.free(holder);
    }
  }

  LinkEvent? pollEvent() {
    final kind = calloc<Uint32>();
    final stream = calloc<Uint32>();
    final code = calloc<Uint32>();
    final bytes = newBuffer();
    try {
      final status = blClientPollEvent(_handle, kind, stream, code, bytes);
      if (status == 0) {
        return null;
      }
      checkStatus(status);
      return switch (kind.value) {
        1 => LinkConnected(code.value == 1),
        2 => LinkMessage(stream.value, takeBuffer(bytes)),
        3 => LinkPeerClosed(code.value),
        _ => const LinkDead(),
      };
    } finally {
      calloc
        ..free(kind)
        ..free(stream)
        ..free(code)
        ..free(bytes);
    }
  }

  /// Milliseconds at which to call [handleTimeout], or null when idle.
  int? pollTimeout() {
    final deadline = blClientPollTimeout(_handle);
    return deadline < 0 ? null : deadline;
  }

  void handleTimeout(int nowMs) => blClientHandleTimeout(_handle, nowMs);

  /// The connection is gone; the session survives for the next [connect].
  void disconnect() => blClientDisconnect(_handle);
}
