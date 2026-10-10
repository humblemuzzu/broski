import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

const _deviceIdContext = 'broski-pair-id';
const _tokenContext = 'broski-pair-token';

/// The relay device id a pairing connection uses.
///
/// Relay credentials are normally issued by the machine, but a pairing starts
/// before any exist, so both sides derive them from the QR secret instead.
String pairingDeviceId(Uint8List secret) =>
    _hex(_digest(_deviceIdContext, secret).sublist(0, 16));

/// The relay token a pairing connection uses.
String pairingToken(Uint8List secret) =>
    base64Url.encode(_digest(_tokenContext, secret)).replaceAll('=', '');

List<int> _digest(String context, Uint8List secret) =>
    sha256.convert([...ascii.encode(context), ...secret]).bytes;

String _hex(List<int> bytes) =>
    [for (final byte in bytes) byte.toRadixString(16).padLeft(2, '0')].join();
