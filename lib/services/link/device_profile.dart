import 'dart:io';

/// What this phone calls itself in a link `hello` control message.
///
/// The daemon names a device from ios, android and web only, so a desktop run
/// announces its platform and stays unnamed until the user names it.
String linkDeviceName() {
  if (Platform.isIOS) return 'iPhone';
  if (Platform.isAndroid) return 'Android';
  if (Platform.isMacOS) return 'Mac';
  if (Platform.isWindows) return 'Windows';
  if (Platform.isLinux) return 'Linux';
  return 'Device';
}

String linkDevicePlatform() {
  if (Platform.isIOS) return 'ios';
  if (Platform.isAndroid) return 'android';
  if (Platform.isMacOS) return 'macos';
  if (Platform.isWindows) return 'windows';
  if (Platform.isLinux) return 'linux';
  return 'unknown';
}

Map<String, Object?> helloControl({required String app}) => {
  't': 'hello',
  'name': linkDeviceName(),
  'platform': linkDevicePlatform(),
  'app': app,
};
