/// The bridge's code for a reply larger than the link will carry.
const String bridgeResponseTooLargeCode = 'response_too_large';

/// An error the bridge answered a request with, `{"type":"error",…}`.
class BridgeResponseException implements Exception {
  const BridgeResponseException({
    required this.message,
    this.code,
    this.bytes,
    this.limit,
  });

  final String message;

  /// The bridge's machine-readable code, when it sends one.
  final String? code;

  /// The reply size refused by [BridgeResponseTooLargeException].
  final int? bytes;

  /// The size limit that refused it.
  final int? limit;

  @override
  String toString() => 'BridgeResponseException(${code ?? 'error'}): $message';
}

/// A reply too large for the link: the same request with a smaller page fits.
final class BridgeResponseTooLargeException extends BridgeResponseException {
  const BridgeResponseTooLargeException({
    required super.message,
    super.code,
    super.bytes,
    super.limit,
  });
}

BridgeResponseException bridgeResponseError(Map<String, dynamic> message) {
  final rawCode = message['code'];
  final code = rawCode is String && rawCode.isNotEmpty ? rawCode : null;
  final rawMessage = message['message'];
  final text = rawMessage is String && rawMessage.isNotEmpty
      ? rawMessage
      : 'Unknown bridge error';
  if (code == bridgeResponseTooLargeCode) {
    final bytes = message['bytes'];
    final limit = message['limit'];
    return BridgeResponseTooLargeException(
      message: text,
      code: code,
      bytes: bytes is int ? bytes : null,
      limit: limit is int ? limit : null,
    );
  }
  return BridgeResponseException(message: text, code: code);
}
