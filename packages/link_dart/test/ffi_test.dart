import 'dart:convert';
import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

void main() {
  test('reports the native ABI version', () {
    expect(abiVersion(), 3);
  });

  test('hashes the known vector for "abc"', () {
    final digest = sha256(Uint8List.fromList(utf8.encode('abc')));
    expect(
      digest.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join(),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('hashes the empty input', () {
    final digest = sha256(Uint8List(0));
    expect(
      digest.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join(),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
}
