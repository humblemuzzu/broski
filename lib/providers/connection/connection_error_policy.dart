bool blocksAutoReconnect({
  required bool entitled,
  required String? error,
}) {
  if (!entitled) return true;

  final errorLower = (error ?? '').toLowerCase();
  final isHardAuthError =
      errorLower.contains('scan a new qr') ||
      errorLower.contains('authentication failed') ||
      errorLower.contains('certificate mismatch') ||
      errorLower.contains('sign-in expired');

  return isHardAuthError;
}
