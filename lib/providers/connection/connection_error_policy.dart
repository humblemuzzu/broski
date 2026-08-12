bool blocksAutoReconnect({required String? error}) {
  final errorLower = (error ?? '').toLowerCase();
  final isHardAuthError =
      errorLower.contains('scan a new qr') ||
      errorLower.contains('authentication failed') ||
      errorLower.contains('certificate mismatch');

  return isHardAuthError;
}
