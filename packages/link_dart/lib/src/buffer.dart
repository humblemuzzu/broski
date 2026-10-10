import 'dart:ffi';
import 'dart:typed_data';

import 'package:broski_link/src/bindings.dart';
import 'package:ffi/ffi.dart';

/// Zeroed storage for one native `BlBuf` result. Free with `calloc.free`.
Pointer<BlBuf> newBuffer() => calloc<BlBuf>();

/// Copies the `BlBuf` in [holder] out to Dart memory and frees the native one.
Uint8List takeBuffer(Pointer<BlBuf> holder) {
  final buffer = holder.ref;
  final bytes = buffer.len == 0
      ? Uint8List(0)
      : Uint8List.fromList(buffer.ptr.asTypedList(buffer.len));
  blBufFree(buffer);
  return bytes;
}

/// Copies [bytes] into native memory. Free with `malloc.free`.
Pointer<Uint8> copyIn(Uint8List bytes) {
  // malloc(0) may return null, which the native side rejects.
  final pointer = malloc.allocate<Uint8>(bytes.isEmpty ? 1 : bytes.length);
  if (bytes.isNotEmpty) {
    pointer.asTypedList(bytes.length).setAll(0, bytes);
  }
  return pointer;
}
