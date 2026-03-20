bool blocksAutoReconnect({
  required bool entitled,
  required String? error,
  required bool licenseRetryAttempted,
}) {
  if (!entitled) return true;

  final errorLower = (error ?? '').toLowerCase();
  final isLicenseError =
      errorLower.contains('subscription') ||
      errorLower.contains('license') ||
      licenseRetryAttempted;
  final isHardAuthError =
      errorLower.contains('scan a new qr') ||
      errorLower.contains('authentication failed') ||
      errorLower.contains('certificate mismatch') ||
      errorLower.contains('sign-in expired');

  return isLicenseError || isHardAuthError;
}
