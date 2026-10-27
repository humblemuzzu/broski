import 'dart:convert';

const String oldBroskiQrMessage =
    'This is an old Broski QR — update broski on your Mac and scan the new code.';

const String notBroskiQrMessage = 'This QR code is not a Broski pairing code.';

const _v1AddressKeys = ['l', 't', 'm', 'f', 'h', 'a'];

String unsupportedQrMessage(String raw) =>
    _isOldBroskiQr(raw) ? oldBroskiQrMessage : notBroskiQrMessage;

bool _isOldBroskiQr(String raw) {
  final Object? decoded;
  try {
    decoded = jsonDecode(raw);
  } on FormatException {
    return false;
  }
  if (decoded is! Map<String, dynamic> || decoded['p'] == null) return false;
  return _v1AddressKeys.any(decoded.containsKey);
}

/// Lets a scanner report a rejected QR once, however many camera frames
/// re-read it.
class ScanRejectionGate {
  ScanRejectionGate({
    this.quietPeriod = const Duration(seconds: 4),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final Duration quietPeriod;
  final DateTime Function() _now;

  String? _lastRaw;
  DateTime? _lastAt;

  bool admit(String raw) {
    final now = _now();
    final lastAt = _lastAt;
    if (raw == _lastRaw &&
        lastAt != null &&
        now.difference(lastAt) < quietPeriod) {
      return false;
    }
    _lastRaw = raw;
    _lastAt = now;
    return true;
  }
}
