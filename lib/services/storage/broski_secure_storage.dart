import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The one secure-storage instance every Broski secret goes through.
///
/// A machine record carries the relay token, so the store is the app's own and
/// this device's only: encrypted shared preferences on Android, which keeps the
/// item out of an auto-backup, and `first_unlock_this_device` on iOS, which keeps
/// it out of a restore onto another phone. Two instances with different options
/// are two different stores on both platforms, so nothing may open its own.
const FlutterSecureStorage broskiSecureStorage = FlutterSecureStorage(
  iOptions: IOSOptions(
    accessibility: KeychainAccessibility.first_unlock_this_device,
  ),
  aOptions: AndroidOptions(encryptedSharedPreferences: true),
);
