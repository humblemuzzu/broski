import 'dart:convert';

import 'package:broski_link/src/bindings.dart';
import 'package:broski_link/src/buffer.dart';
import 'package:ffi/ffi.dart';

sealed class LinkException implements Exception {
  const LinkException(this.code, this.message);

  final int code;
  final String message;

  @override
  String toString() => 'LinkException($code): $message';
}

final class LinkArgumentException extends LinkException {
  const LinkArgumentException(super.code, super.message);
}

final class LinkProtocolException extends LinkException {
  const LinkProtocolException(super.code, super.message);
}

final class LinkBackpressureException extends LinkException {
  const LinkBackpressureException(super.code, super.message);
}

/// No handshake has completed on this link yet, so nothing can leave on it.
final class LinkNotReadyException extends LinkException {
  const LinkNotReadyException(super.code, super.message);
}

final class LinkPanicException extends LinkException {
  const LinkPanicException(super.code, super.message);
}

/// Returns [status] when it is not an error, otherwise throws.
int checkStatus(int status) {
  if (status >= 0) {
    return status;
  }
  throw switch (status) {
    -1 => LinkArgumentException(status, lastErrorMessage()),
    -3 => LinkBackpressureException(status, lastErrorMessage()),
    -4 => LinkNotReadyException(status, lastErrorMessage()),
    -99 => LinkPanicException(status, lastErrorMessage()),
    _ => LinkProtocolException(status, lastErrorMessage()),
  };
}

String lastErrorMessage() {
  final holder = newBuffer();
  try {
    if (blLastError(holder) != 1) {
      return 'no error recorded on this thread';
    }
    return utf8.decode(takeBuffer(holder), allowMalformed: true);
  } finally {
    calloc.free(holder);
  }
}
